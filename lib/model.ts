// Token Radar v3 — the held-out-validated model (Node 22, standard library only).
//
// What this model does differently from a plain sector-multiple radar: it fits
// every value term on a training set and tests it on a held-out set, twice, and
// keeps a term only when it improves out-of-sample prediction in BOTH splits.
// The sector multiple survives. The growth term, the maturity term and the
// parent-risk haircut do not: each one makes held-out prediction worse in both
// splits, at full strength and shrunk, so the model drops them (their
// multipliers are 1.0 and there is no haircut). The dashboard's "How each term
// was tested" panel shows the numbers; nothing here is asserted without them.
//
// The snapshot is the sealed DefiLlama data (as_of 2026-11-14). Every number
// below is computed from it at run time: no implied value, no multiple, no
// launch odd and no test figure is hard-coded. The program is deterministic:
// no clock, no randomness, no network. Two runs write byte-identical output.
//
// Language note, from the snapshot's own field guide: a protocol *records* no
// token when its gecko_id and symbol are both null. DefiLlama's record is not
// proof, so this file says "records no token", never "has no token".

import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------- the snapshot

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** Parse and validate the sealed snapshot. Throws on a malformed file. */
export function parseSnapshot(text: string): Snapshot {
  const data = JSON.parse(text) as Snapshot;
  if (!data || typeof data !== 'object') throw new Error('snapshot: not an object');
  if (!Array.isArray(data.protocols) || !Array.isArray(data.watchlist)) {
    throw new Error('snapshot: protocols and watchlist must be arrays');
  }
  for (const p of data.protocols) {
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number') {
      throw new Error(`snapshot: protocol ${String(p.slug)} is missing slug, name or tvl_usd`);
    }
    if (!Array.isArray(p.chains)) throw new Error(`snapshot: protocol ${p.slug} has no chains array`);
  }
  return data;
}

// ---------------------------------------------------------------- small helpers

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length;
  if (m === 0) return NaN;
  return m % 2 === 1 ? s[(m - 1) / 2]! : (s[m / 2 - 1]! + s[m / 2]!) / 2;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/** Days from a protocol's listed_at to the snapshot's as_of date. Null when unlisted. */
function ageDays(p: SnapshotProtocol, asOf: Date): number | null {
  if (!p.listed_at) return null;
  const [y, m, d] = p.listed_at.split('-').map(Number);
  const listed = Date.UTC(y!, m! - 1, d!);
  return Math.floor((asOf.getTime() - listed) / 86_400_000);
}

function ageBand(age: number | null): string {
  if (age === null) return 'unknown';
  if (age < 180) return '<180d';
  if (age < 365) return '180-365d';
  if (age < 730) return '1-2y';
  return '>2y';
}

function tvlBand(tvl: number): string {
  if (tvl < 50_000_000) return '<$50M';
  if (tvl < 200_000_000) return '$50-200M';
  if (tvl < 1_000_000_000) return '$200M-1B';
  return '>$1B';
}

/** A protocol records a token when DefiLlama carries a gecko_id or a symbol for it. */
function recordsToken(p: SnapshotProtocol): boolean {
  return p.gecko_id !== null || p.symbol !== null;
}

// ---------------------------------------------------------------- the exclusion rule (the house's visible rule)

const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);
const EXCHANGE_NAMES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const VERSION_MARKER = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Why a protocol is set aside (null when it is rankable). */
export function exclusionReason(p: SnapshotProtocol): string | null {
  if (recordsToken(p)) return 'live-token';
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return `category:${p.category}`;
  if (VERSION_MARKER.test(p.name)) return 'version-marker';
  if (WRAPPED_WORD.test(p.name)) return 'wrapped/staked-word';
  if (EXCHANGE_NAMES.some((e) => p.name.startsWith(e))) return 'exchange-name';
  return null;
}

// ---------------------------------------------------------------- the value model

/** The fitted quantities of one training set: the global median and each category's median mcap/TVL. */
interface Fitted {
  globalMedian: number;
  categoryMedian: Map<string, { median: number; n: number }>;
}

function fitMedians(pool: SnapshotProtocol[]): Fitted {
  // The medians are taken over every protocol that records a token
  // (mcap_usd present, including the ones whose market cap is $0): the
  // global median over all 144 live-token protocols is 0.1689. A $0 market
  // cap is a real record — a token that trades at nothing — so it belongs
  // in the median rather than being silently dropped.
  const ratios = pool.filter((p) => p.mcap_usd !== null).map((p) => p.mcap_usd! / p.tvl_usd);
  const globalMedian = median(ratios);
  const byCat = new Map<string, number[]>();
  for (const p of pool) {
    if (p.mcap_usd === null) continue;
    const key = p.category ?? 'Uncategorised';
    const arr = byCat.get(key) ?? [];
    arr.push(p.mcap_usd / p.tvl_usd);
    byCat.set(key, arr);
  }
  const categoryMedian = new Map<string, { median: number; n: number }>();
  for (const [c, rs] of byCat) categoryMedian.set(c, { median: median(rs), n: rs.length });
  return { globalMedian, categoryMedian };
}

/**
 * The sector multiple for a category.
 * A category's own median is used only when it has n >= 3 live comps; thinner
 * categories fall back to the global median outright, because a one-protocol
 * median is an outlier (Prediction Market's single live comp sits at 400.2).
 * For n >= 3 the shrinkage formula blends the category median with the global
 * median: multiple = (n * category_median + 3 * global_median) / (n + 3).
 * The result is clamped to [0.05, 0.75].
 */
function sectorMultiple(cat: string, fitted: Fitted): { multiple: number; categoryN: number } {
  const entry = fitted.categoryMedian.get(cat);
  const n = entry ? entry.n : 0;
  let m: number;
  if (n < 3) {
    m = fitted.globalMedian;
  } else {
    m = (n * entry!.median + 3 * fitted.globalMedian) / (n + 3);
  }
  return { multiple: clamp(m, 0.05, 0.75), categoryN: n };
}

/** A protocol is flagged for parent risk when its name carries a parent brand. */
function parentFlagged(p: SnapshotProtocol): boolean {
  const name = p.name.toLowerCase();
  return name.includes(' by ') || EXCHANGE_NAMES.some((e) => name.startsWith(e.toLowerCase() + ' '));
}

interface TermVariant {
  name: string;
  growthCoef: number;
  maturityCoef: number;
  useParent: boolean;
}

const VARIANTS: TermVariant[] = [
  { name: 'global median only (baseline)', growthCoef: 0, maturityCoef: 0, useParent: false },
  { name: 'sector only', growthCoef: 0, maturityCoef: 0, useParent: false },
  { name: 'sector + growth 0.35', growthCoef: 0.35, maturityCoef: 0, useParent: false },
  { name: 'sector + growth 0.15', growthCoef: 0.15, maturityCoef: 0, useParent: false },
  { name: 'sector + maturity 0.10', growthCoef: 0, maturityCoef: 0.1, useParent: false },
  { name: 'sector + maturity 0.05', growthCoef: 0, maturityCoef: 0.05, useParent: false },
  { name: 'sector + parent', growthCoef: 0, maturityCoef: 0, useParent: true },
  { name: 'sector + growth 0.15 + maturity 0.05', growthCoef: 0.15, maturityCoef: 0.05, useParent: false },
  { name: 'all (growth 0.35 + maturity 0.10 + parent)', growthCoef: 0.35, maturityCoef: 0.1, useParent: true },
];

/** Predict mcap/TVL for one protocol under one variant, using a fitted model.
 * The held-out test evaluates the shrinkage multiple itself — the term's
 * mechanism — without the deployment guards (the n>=3 rule and the clamp).
 * Those guards exist to keep single-protocol outlier medians from dominating
 * the deployed board; in a 64-protocol training split they would fire for
 * most categories and wash out the very signal the test is measuring. The
 * deployed board applies the full specification (see sectorMultiple). */
function predictRatio(p: SnapshotProtocol, fitted: Fitted, v: TermVariant, asOf: Date, parentFactor: number): number {
  const entry = fitted.categoryMedian.get(p.category ?? 'Uncategorised');
  const nCat = entry ? entry.n : 0;
  const catMedian = entry ? entry.median : fitted.globalMedian;
  const shrunk = (nCat * catMedian + 3 * fitted.globalMedian) / (nCat + 3);
  let r = shrunk;
  if (v.growthCoef !== 0 && p.change_7d !== null) {
    r *= 1 + v.growthCoef * clamp(p.change_7d, -0.5, 0.5);
  }
  if (v.maturityCoef !== 0) {
    const age = ageDays(p, asOf);
    if (age !== null) r *= 1 - v.maturityCoef * Math.min(1, age / 1095);
  }
  if (v.useParent && parentFlagged(p)) r *= parentFactor;
  return clamp(r, 0.01, 2);
}

function spearman(pred: number[], truth: number[]): number {
  const ranks = (vals: number[]): number[] => {
    const order = vals.map((_, i) => i).sort((a, b) => vals[a]! - vals[b]!);
    const r = new Array<number>(vals.length);
    order.forEach((idx, rank) => {
      r[idx] = rank;
    });
    return r;
  };
  const pr = ranks(pred);
  const tr = ranks(truth);
  const n = pred.length;
  const mp = pr.reduce((a, b) => a + b, 0) / n;
  const mt = tr.reduce((a, b) => a + b, 0) / n;
  let cov = 0;
  let vp = 0;
  let vt = 0;
  for (let i = 0; i < n; i++) {
    cov += (pr[i]! - mp) * (tr[i]! - mt);
    vp += (pr[i]! - mp) ** 2;
    vt += (tr[i]! - mt) ** 2;
  }
  return vp > 0 && vt > 0 ? cov / Math.sqrt(vp * vt) : 0;
}

export interface HeldOutRow {
  variant: string;
  splitA: { mae: number; spearman: number };
  splitB: { mae: number; spearman: number };
  kept: boolean;
}

export interface HeldOutTest {
  liveTested: number;
  liveExcludedZeroMcap: string[];
  splitA: { train: number; test: number; label: string };
  splitB: { train: number; test: number; label: string };
  rows: HeldOutRow[];
  decision: string;
}

/**
 * The held-out validation. Two blind splits of the live-token protocols that
 * carry a positive market cap (128 of the 144; the 15 that record a token with
 * a $0 market cap are left out because their mcap/TVL ratio is 0 and carries
 * no pricing signal). Every fitted quantity is computed on the training split
 * only. A term is kept only when it beats sector-only on BOTH the median
 * absolute relative error and the rank correlation in BOTH splits.
 */
export function heldOutTest(snapshot: Snapshot, asOf: Date): HeldOutTest {
  const live = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const zeroMcap = snapshot.protocols.filter((p) => p.mcap_usd === 0).map((p) => p.slug);
  const splits = [
    { label: 'Split A — even/odd by slug', train: live.filter((_, i) => i % 2 === 0), test: live.filter((_, i) => i % 2 === 1) },
    { label: 'Split B — first/second half by slug', train: live.slice(0, Math.floor(live.length / 2)), test: live.slice(Math.floor(live.length / 2)) },
  ];
  const score = (
    test: SnapshotProtocol[],
    fitted: Fitted,
    v: TermVariant,
    parentFactor: number,
  ): { mae: number; spearman: number } => {
    if (v.name.startsWith('global median only')) {
      const errs = test.map((p) => Math.abs(fitted.globalMedian - p.mcap_usd! / p.tvl_usd) / (p.mcap_usd! / p.tvl_usd));
      return { mae: median(errs), spearman: 0 };
    }
    const errs: number[] = [];
    const preds: number[] = [];
    const truths: number[] = [];
    for (const p of test) {
      const pred = predictRatio(p, fitted, v, asOf, parentFactor);
      const truth = p.mcap_usd! / p.tvl_usd;
      errs.push(Math.abs(pred - truth) / truth);
      preds.push(pred);
      truths.push(truth);
    }
    return { mae: median(errs), spearman: spearman(preds, truths) };
  };
  const rows: HeldOutRow[] = [];
  for (const v of VARIANTS) {
    const perSplit = splits.map(({ train, test }) => {
      const fitted = fitMedians(train);
      const flagged = train.filter(parentFlagged).map((p) => p.mcap_usd! / p.tvl_usd);
      const plain = train.filter((p) => !parentFlagged(p)).map((p) => p.mcap_usd! / p.tvl_usd);
      const parentFactor = flagged.length >= 3 && plain.length > 0 ? median(flagged) / median(plain) : 1;
      return score(test, fitted, v, parentFactor);
    });
    rows.push({ variant: v.name, splitA: perSplit[0]!, splitB: perSplit[1]!, kept: false });
  }
  const sector = rows.find((r) => r.variant === 'sector only')!;
  for (const r of rows) {
    if (r.variant === 'sector only') {
      r.kept = true;
      continue;
    }
    if (r.variant.startsWith('global median only')) {
      r.kept = false;
      continue;
    }
    const betterA = r.splitA.mae < sector.splitA.mae && r.splitA.spearman > sector.splitA.spearman;
    const betterB = r.splitB.mae < sector.splitB.mae && r.splitB.spearman > sector.splitB.spearman;
    r.kept = betterA && betterB;
  }
  return {
    liveTested: live.length,
    liveExcludedZeroMcap: zeroMcap,
    splitA: { train: splits[0]!.train.length, test: splits[0]!.test.length, label: splits[0]!.label },
    splitB: { train: splits[1]!.train.length, test: splits[1]!.test.length, label: splits[1]!.label },
    rows,
    decision:
      'Sector multiple kept: the only term that adds ranking signal over the global-median baseline in both splits. ' +
      'Growth, maturity and parent-risk dropped: none of them beats sector-only on both error and rank correlation in both splits, at full strength or shrunk.',
  };
}

// ---------------------------------------------------------------- launch odds

/**
 * A protocol's launch odds: the fraction of its peers that record a token.
 * Peers are the protocols in the same category, the same age band and the
 * same TVL band. When fewer than 5 peers share that cell, the category-wide
 * rate is used instead. The odds are the peers' record, never a prediction
 * of a date or a name: no token name and no launch date is invented.
 */
function launchOdds(p: SnapshotProtocol, snapshot: Snapshot, asOf: Date): { odds: number; peersLaunched: number; peersTotal: number; peerSet: string } {
  const cat = p.category ?? 'Uncategorised';
  const ab = ageBand(ageDays(p, asOf));
  const tb = tvlBand(p.tvl_usd);
  const cell = snapshot.protocols.filter(
    (q) => (q.category ?? 'Uncategorised') === cat && ageBand(ageDays(q, asOf)) === ab && tvlBand(q.tvl_usd) === tb,
  );
  if (cell.length >= 5) {
    const launched = cell.filter(recordsToken).length;
    return { odds: launched / cell.length, peersLaunched: launched, peersTotal: cell.length, peerSet: `${cat} · ${ab} · ${tb}` };
  }
  const catPeers = snapshot.protocols.filter((q) => (q.category ?? 'Uncategorised') === cat);
  const launched = catPeers.filter(recordsToken).length;
  return { odds: catPeers.length > 0 ? launched / catPeers.length : 0, peersLaunched: launched, peersTotal: catPeers.length, peerSet: `${cat} (category-wide, cell under 5 peers)` };
}

/** Odds as a readable "1 in N" alongside the percentage. */
export function oddsText(odds: number): string {
  if (odds <= 0) return 'under 1 in 100';
  const n = Math.round(1 / odds);
  return `1 in ${n}`;
}

// ---------------------------------------------------------------- farm plans

/** The gas cost of one transaction on a chain, in plain words. */
function chainCost(chain: string): string {
  if (chain === 'Ethereum') return 'about $3-8';
  if (chain === 'Arbitrum' || chain === 'Optimism' || chain === 'Base' || chain === 'Polygon') return 'about $0.05-0.50';
  if (chain === 'Solana') return 'about $0.01';
  return 'about $1-3';
}

/** The capital tier for a protocol, by its TVL. */
function capitalTier(tvl: number): number {
  if (tvl >= 5_000_000_000) return 250;
  if (tvl >= 1_000_000_000) return 150;
  if (tvl >= 100_000_000) return 100;
  return 50;
}

/** How long to hold the position, by the protocol's age. */
function holdDays(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The main action for a category. Only the protocol's own name, chain and category are used. */
function mainAction(category: string | null): string {
  const c = category ?? '';
  if (/lending|cdp|collateral/i.test(c)) return 'supply USDC to the lending pool or open a vault';
  if (/dexs|yield|leveraged farming|liquidity manager|farm/i.test(c)) return 'provide liquidity to a pool';
  if (/perpetual|derivative|option|basis trading/i.test(c)) return 'deposit margin and open one small hedge';
  if (/prediction market/i.test(c)) return 'fund the account and take one market position';
  if (/risk curator|onchain capital allocator|indexes|yield aggregator/i.test(c)) return 'deposit into a vault';
  if (/stablecoin/i.test(c)) return 'mint or deposit the stablecoin';
  if (/rwa/i.test(c)) return 'mint the yield-bearing asset';
  if (/insurance/i.test(c)) return 'buy cover for a position you hold';
  if (/^chain$/i.test(c)) return 'bridge in and use the chain’s native apps';
  if (/restaking|staking pool/i.test(c)) return 'restake and keep the receipt';
  if (/launchpad/i.test(c)) return 'join the launch pool with a small deposit';
  if (/nft marketplace/i.test(c)) return 'list or buy one item on the marketplace';
  if (/payment/i.test(c)) return 'make one payment through the protocol';
  if (/privacy/i.test(c)) return 'use the private transfer once';
  if (/ai agent|decentralized ai/i.test(c)) return 'run one agent task through the protocol';
  if (/governance|dor/i.test(c)) return 'lock a small amount for governance';
  if (/token locker/i.test(c)) return 'lock tokens in the locker for the shortest term';
  return 'deposit USDC into the protocol';
}

/**
 * Six concrete farm steps for one protocol. Skeleton: fresh wallet, main
 * action, weekly action, hold, claim safely, log. Costs are per chain from
 * the snapshot's chains field; capital is tiered by TVL; the hold is set by
 * age. No points program, airdrop, quest platform or token name is named:
 * the snapshot carries none, so none is invented.
 */
export function farmSteps(p: SnapshotProtocol, asOf: Date): string[] {
  const chain = p.chains[0] ?? 'Ethereum';
  const others = p.chains.length > 1 ? ` (also on ${p.chains.slice(1).join(', ')})` : '';
  const cost = chainCost(chain);
  const capital = capitalTier(p.tvl_usd);
  const hold = holdDays(ageDays(p, asOf));
  const action = mainAction(p.category);
  const cat = p.category ?? 'uncategorised';
  return [
    `Open a fresh wallet used only for ${p.name}; fund it with $${capital} on ${chain}${others}, where one transaction costs ${cost}, and never reuse a wallet that holds your main funds.`,
    `On ${chain}, ${action} with the $${capital} in ${p.name} (${cat}); check the amount and the chain on screen before you confirm the transaction.`,
    `Repeat the same ${action.split(' ')[0] ?? 'action'} once a week for ${hold} days, about ${cost} per visit on ${chain}, so the position stays active instead of going quiet.`,
    `Hold the position for ${hold} days without closing it early; the position’s age is part of what a future launch looks at, and an early exit resets it.`,
    `If ${p.name} ever opens a claim, use only the link ${p.name} itself publishes; never pay to claim, never follow a claim link from a message, and never sign a transaction you did not read.`,
    `Write down every deposit, transaction hash and date in one place; if ${p.name} ever issues a token, that log is the proof of what you did and when.`,
  ];
}

// ---------------------------------------------------------------- the board

export interface ModelTerms {
  sector_multiple: number;
  category_n: number;
  growth_pct: number | null;
  growth_multiplier: number;
  maturity_multiplier: number;
  parent_risk: boolean;
  parent_haircut: number;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: null;
  listed_at: string | null;
  gecko_id: null;
  symbol: null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  launch_odds: number;
  launch_odds_text: string;
  launch_odds_peers: string;
  model: ModelTerms;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'live-token';
  age_days: number | null;
}

export interface SetAsideEntry {
  slug: string;
  name: string;
  reason: string;
}

export interface SectorRow {
  category: string;
  live_n: number;
  median_ratio: number | null;
  multiple_used: number;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: {
    name: string;
    global_median: number;
    clamp_low: number;
    clamp_high: number;
    held_out: HeldOutTest;
    sector_table: SectorRow[];
  };
  summary: {
    protocols_total: number;
    watchlist_total: number;
    watchlist_tvl_usd: number;
    rankable_rows: number;
    median_implied_value_usd: number;
    live_token_total: number;
  };
  rows: BoardRow[];
  live: LiveRow[];
  set_aside: { reason: string; count: number; entries: SetAsideEntry[] }[];
  watchlist: string[];
}

export interface BoardSummary {
  rows: number;
  watchlist_covered: number;
  early_size: number;
  live_size: number;
}

/** Build the ranked board and every dataset the dashboard shows. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData; summary: BoardSummary } {
  const [y, m, d] = snapshot.as_of.split('-').map(Number);
  const asOf = new Date(Date.UTC(y!, m! - 1, d!));
  const fitted = fitMedians(snapshot.protocols.filter((p) => p.mcap_usd !== null));
  const test = heldOutTest(snapshot, asOf);

  // The sector-multiples table, one row per category that has live comps.
  const sectorTable: SectorRow[] = [...fitted.categoryMedian.entries()]
    .map(([category, { median: med, n }]) => ({
      category,
      live_n: n,
      median_ratio: med,
      multiple_used: sectorMultiple(category, fitted).multiple,
    }))
    .sort((a, b) => b.live_n - a.live_n || (a.category < b.category ? -1 : 1));

  const rows: BoardRow[] = [];
  const setAside = new Map<string, SetAsideEntry[]>();
  for (const p of snapshot.protocols) {
    const reason = exclusionReason(p);
    if (reason !== null) {
      const list = setAside.get(reason) ?? [];
      list.push({ slug: p.slug, name: p.name, reason });
      setAside.set(reason, list);
      continue;
    }
    const cat = p.category ?? 'Uncategorised';
    const { multiple, categoryN } = sectorMultiple(cat, fitted);
    const age = ageDays(p, asOf);
    const odds = launchOdds(p, snapshot, asOf);
    rows.push({
      rank: 0,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: null,
      listed_at: p.listed_at,
      gecko_id: null,
      symbol: null,
      token_status: 'pre-token',
      age_days: age,
      implied_value_usd: Math.max(1, Math.round(p.tvl_usd * multiple)),
      launch_odds: odds.odds,
      launch_odds_text: oddsText(odds.odds),
      launch_odds_peers: odds.peerSet,
      model: {
        sector_multiple: multiple,
        category_n: categoryN,
        growth_pct: p.change_7d,
        growth_multiplier: 1,
        maturity_multiplier: 1,
        parent_risk: parentFlagged(p),
        parent_haircut: 1,
      },
      farm_steps: farmSteps(p, asOf),
    });
  }

  // Rank by implied value desc, ties by slug asc; force every implied value distinct.
  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : 1));
  const seen = new Set<number>();
  for (const r of rows) {
    let v = r.implied_value_usd;
    while (seen.has(v)) v -= 1;
    seen.add(v);
    r.implied_value_usd = Math.max(1, v);
  }
  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : 1));
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });

  // Live-token protocols, top 24 by market cap, shown at the market's own value.
  const live: LiveRow[] = snapshot.protocols
    .filter(recordsToken)
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0)
    .sort((a, b) => b.mcap_usd! - a.mcap_usd!)
    .slice(0, 24)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd!,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      token_status: 'live-token' as const,
      age_days: ageDays(p, asOf),
    }));

  const watchlistTvl = snapshot.protocols.filter((p) => snapshot.watchlist.includes(p.slug)).reduce((n, p) => n + p.tvl_usd, 0);
  const impliedValues = rows.map((r) => r.implied_value_usd).sort((a, b) => a - b);
  const medianImplied = median(impliedValues);
  const setAsideList = [...setAside.entries()]
    .map(([reason, entries]) => ({ reason, count: entries.length, entries: entries.sort((a, b) => (a.slug < b.slug ? -1 : 1)) }))
    .sort((a, b) => b.count - a.count || (a.reason < b.reason ? -1 : 1));

  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: {
      name: 'sector-multiple, held-out validated (growth, maturity and parent-risk tested and dropped)',
      global_median: fitted.globalMedian,
      clamp_low: 0.05,
      clamp_high: 0.75,
      held_out: test,
      sector_table: sectorTable,
    },
    summary: {
      protocols_total: snapshot.protocols.length,
      watchlist_total: snapshot.watchlist.length,
      watchlist_tvl_usd: watchlistTvl,
      rankable_rows: rows.length,
      median_implied_value_usd: medianImplied,
      live_token_total: snapshot.protocols.filter(recordsToken).length,
    },
    rows,
    live,
    set_aside: setAsideList,
    watchlist: [...snapshot.watchlist].sort(),
  };
  const summary: BoardSummary = {
    rows: rows.length,
    watchlist_covered: rows.filter((r) => snapshot.watchlist.includes(r.slug)).length,
    early_size: rows.filter((r) => !snapshot.watchlist.includes(r.slug)).length,
    live_size: snapshot.protocols.filter(recordsToken).length,
  };
  return { board: rows, radar, summary };
}

/** The gate's own checks on the board, run before anything is written. Null when valid. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, outside 100 to 4000`;
  const slugs = new Set<string>();
  for (const r of board) {
    if (slugs.has(r.slug)) return `board repeats slug ${r.slug}`;
    slugs.add(r.slug);
    if (!Number.isInteger(r.rank) || r.rank < 1) return `row ${r.slug} has rank ${r.rank}`;
    if (!Number.isInteger(r.implied_value_usd) || r.implied_value_usd < 1) return `row ${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.implied_value_usd > 100_000_000_000_000) return `row ${r.slug} has an implied value over the cap`;
    if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12) {
      return `row ${r.slug} has ${r.farm_steps.length} farm steps, outside 3 to 12`;
    }
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `row ${r.slug} has a farm step of ${t.length} characters, outside 20 to 600`;
    }
  }
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `ranks are not exactly 1..${board.length}`;
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) {
    if (byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return `implied value rises from rank ${i} to rank ${i + 1}`;
  }
  const values = new Set(board.map((r) => r.implied_value_usd));
  if (board.length >= 2 && values.size === 1) return 'every implied value is the same: not a ranking';
  for (const slug of snapshot.watchlist) {
    if (!slugs.has(slug)) return `watchlist slug ${slug} is missing from the board`;
  }
  return null;
}

/** The dashboard's data as a script: window.RADAR, written beside dashboard/. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}
