// QuickBooks Online integration: OAuth 2.0 + read-only sync.
// This app NEVER writes back to QuickBooks — every call here is a GET/query.
// Endpoints are env-configurable in case Intuit changes them.

import { prisma } from "./db";
import { encrypt, decrypt } from "./crypto";
import type { QboConnection } from "@prisma/client";

const SCOPE = "com.intuit.quickbooks.accounting";

function cfg() {
  return {
    clientId: process.env.QBO_CLIENT_ID ?? "",
    clientSecret: process.env.QBO_CLIENT_SECRET ?? "",
    authUrl: process.env.QBO_AUTH_URL ?? "https://appcenter.intuit.com/connect/oauth2",
    tokenUrl: process.env.QBO_TOKEN_URL ?? "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
    redirectUri: process.env.QBO_REDIRECT_URI ?? "http://localhost:4545/api/qbo/callback",
    sandbox: (process.env.QBO_ENVIRONMENT ?? "sandbox") !== "production",
    apiBase:
      (process.env.QBO_ENVIRONMENT ?? "sandbox") !== "production"
        ? process.env.QBO_API_BASE_SANDBOX ?? "https://sandbox-quickbooks.api.intuit.com"
        : process.env.QBO_API_BASE_PRODUCTION ?? "https://quickbooks.api.intuit.com",
  };
}

export function qboConfigured(): boolean {
  const c = cfg();
  return Boolean(c.clientId && c.clientSecret);
}

export function buildAuthUrl(entitySlug: string): string {
  const c = cfg();
  const params = new URLSearchParams({
    client_id: c.clientId,
    response_type: "code",
    scope: SCOPE,
    redirect_uri: c.redirectUri,
    state: entitySlug,
  });
  return `${c.authUrl}?${params.toString()}`;
}

function basicAuth(): string {
  const c = cfg();
  return Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64");
}

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds (~1h)
  x_refresh_token_expires_in: number; // seconds (~100 days)
};

async function tokenRequest(body: URLSearchParams): Promise<TokenResponse> {
  const c = cfg();
  const res = await fetch(c.tokenUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth()}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });
  if (!res.ok) {
    // Deliberately do not log the response body verbatim elsewhere with tokens
    throw new Error(`QuickBooks token endpoint returned ${res.status}`);
  }
  return (await res.json()) as TokenResponse;
}

export async function exchangeCode(code: string): Promise<TokenResponse> {
  const c = cfg();
  return tokenRequest(
    new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: c.redirectUri })
  );
}

export async function saveConnection(entitySlug: string, realmId: string, tokens: TokenResponse) {
  const entity = await prisma.entity.findUniqueOrThrow({ where: { slug: entitySlug } });
  const now = Date.now();
  const data = {
    realmId,
    accessTokenEnc: encrypt(tokens.access_token),
    refreshTokenEnc: encrypt(tokens.refresh_token),
    accessTokenExpiresAt: new Date(now + tokens.expires_in * 1000),
    refreshTokenExpiresAt: new Date(now + tokens.x_refresh_token_expires_in * 1000),
    sandbox: cfg().sandbox,
  };
  await prisma.qboConnection.upsert({
    where: { entityId: entity.id },
    update: data,
    create: { entityId: entity.id, ...data },
  });
}

async function freshAccessToken(conn: QboConnection): Promise<string> {
  if (conn.accessTokenExpiresAt.getTime() > Date.now() + 60_000) {
    return decrypt(conn.accessTokenEnc);
  }
  const tokens = await tokenRequest(
    new URLSearchParams({ grant_type: "refresh_token", refresh_token: decrypt(conn.refreshTokenEnc) })
  );
  const now = Date.now();
  await prisma.qboConnection.update({
    where: { id: conn.id },
    data: {
      accessTokenEnc: encrypt(tokens.access_token),
      refreshTokenEnc: encrypt(tokens.refresh_token),
      accessTokenExpiresAt: new Date(now + tokens.expires_in * 1000),
      refreshTokenExpiresAt: new Date(now + tokens.x_refresh_token_expires_in * 1000),
    },
  });
  return tokens.access_token;
}

async function qboQuery(conn: QboConnection, query: string): Promise<any> {
  const token = await freshAccessToken(conn);
  const url = `${cfg().apiBase}/v3/company/${conn.realmId}/query?query=${encodeURIComponent(query)}&minorversion=75`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`QuickBooks query failed (${res.status})`);
  return res.json();
}

// Map QBO account classifications onto our simple report types
function mapAccountType(qboType: string): string {
  switch (qboType) {
    case "Income": case "Other Income": return "income";
    case "Expense": case "Other Expense": return "expense";
    case "Cost of Goods Sold": return "cogs";
    case "Bank": return "bank";
    case "Fixed Asset": return "fixed_asset";
    case "Other Asset": case "Other Current Asset": case "Accounts Receivable": return "other_asset";
    case "Credit Card": return "credit_card";
    case "Long Term Liability": case "Other Current Liability": case "Accounts Payable": return "liability";
    case "Equity": return "equity";
    default: return "other_asset";
  }
}

/**
 * Pull chart of accounts + money-movement records for one entity and store a
 * local copy. Read-only. Existing demo data for the entity is replaced by real
 * data on first successful sync.
 */
export async function syncEntity(entitySlug: string): Promise<{ accounts: number; transactions: number }> {
  const entity = await prisma.entity.findUniqueOrThrow({
    where: { slug: entitySlug },
    include: { connection: true },
  });
  const conn = entity.connection;
  if (!conn) throw new Error("Entity is not connected to QuickBooks");

  // 1. Chart of accounts
  const accountsRes = await qboQuery(conn, "select * from Account maxresults 1000");
  const qboAccounts: any[] = accountsRes?.QueryResponse?.Account ?? [];

  // First real sync clears the demo books for this entity
  const hadDemo = await prisma.transaction.count({ where: { entityId: entity.id, source: "demo" } });
  if (hadDemo > 0) {
    await prisma.transaction.deleteMany({ where: { entityId: entity.id, source: "demo" } });
    await prisma.account.deleteMany({ where: { entityId: entity.id } });
  }

  const accountIdByQboId = new Map<string, string>();
  for (const a of qboAccounts) {
    const existing = await prisma.account.findFirst({ where: { entityId: entity.id, qboId: a.Id } });
    const data = {
      name: a.Name as string,
      type: mapAccountType(a.AccountType),
      subtype: (a.AccountSubType as string) ?? null,
      openingBalance: typeof a.CurrentBalance === "number" ? a.CurrentBalance : 0,
    };
    const rec = existing
      ? await prisma.account.update({ where: { id: existing.id }, data })
      : await prisma.account.create({ data: { entityId: entity.id, qboId: a.Id, ...data } });
    accountIdByQboId.set(a.Id, rec.id);
  }

  // 2. Money movement: purchases (expenses), deposits, invoices, bills
  let txnCount = 0;
  const upsertTxn = async (qboId: string, fields: {
    date: string; amount: number; flow: "in" | "out"; vendor?: string;
    description?: string; accountQboId?: string;
  }) => {
    if (!fields.amount || fields.amount <= 0) return;
    const accountId = fields.accountQboId ? accountIdByQboId.get(fields.accountQboId) ?? null : null;
    const existing = await prisma.transaction.findFirst({ where: { entityId: entity.id, qboId } });
    const data = {
      date: new Date(fields.date),
      amount: Math.abs(fields.amount),
      flow: fields.flow,
      vendor: fields.vendor ?? null,
      description: fields.description ?? null,
      accountId,
      categoryStatus: accountId ? "categorized" : "uncategorized",
      source: "qbo",
    };
    if (existing) await prisma.transaction.update({ where: { id: existing.id }, data });
    else await prisma.transaction.create({ data: { entityId: entity.id, qboId, ...data } });
    txnCount++;
  };

  const purchases = (await qboQuery(conn, "select * from Purchase maxresults 1000"))?.QueryResponse?.Purchase ?? [];
  for (const p of purchases) {
    const line = p.Line?.find((l: any) => l.AccountBasedExpenseLineDetail);
    await upsertTxn(`Purchase:${p.Id}`, {
      date: p.TxnDate, amount: p.TotalAmt, flow: "out",
      vendor: p.EntityRef?.name, description: p.PrivateNote ?? "Purchase",
      accountQboId: line?.AccountBasedExpenseLineDetail?.AccountRef?.value,
    });
  }
  const deposits = (await qboQuery(conn, "select * from Deposit maxresults 1000"))?.QueryResponse?.Deposit ?? [];
  for (const d of deposits) {
    const line = d.Line?.find((l: any) => l.DepositLineDetail);
    await upsertTxn(`Deposit:${d.Id}`, {
      date: d.TxnDate, amount: d.TotalAmt, flow: "in",
      vendor: line?.DepositLineDetail?.Entity?.name, description: d.PrivateNote ?? "Deposit",
      accountQboId: line?.DepositLineDetail?.AccountRef?.value,
    });
  }
  const invoices = (await qboQuery(conn, "select * from Invoice maxresults 1000"))?.QueryResponse?.Invoice ?? [];
  for (const inv of invoices) {
    await upsertTxn(`Invoice:${inv.Id}`, {
      date: inv.TxnDate, amount: inv.TotalAmt, flow: "in",
      vendor: inv.CustomerRef?.name, description: `Invoice #${inv.DocNumber ?? inv.Id}`,
    });
  }
  const bills = (await qboQuery(conn, "select * from Bill maxresults 1000"))?.QueryResponse?.Bill ?? [];
  for (const b of bills) {
    const line = b.Line?.find((l: any) => l.AccountBasedExpenseLineDetail);
    await upsertTxn(`Bill:${b.Id}`, {
      date: b.TxnDate, amount: b.TotalAmt, flow: "out",
      vendor: b.VendorRef?.name, description: `Bill #${b.DocNumber ?? b.Id}`,
      accountQboId: line?.AccountBasedExpenseLineDetail?.AccountRef?.value,
    });
  }

  await prisma.qboConnection.update({ where: { id: conn.id }, data: { lastSyncedAt: new Date() } });
  return { accounts: qboAccounts.length, transactions: txnCount };
}
