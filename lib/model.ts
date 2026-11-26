// Token Launch Radar — model "radar-2".
//
// One sealed DefiLlama snapshot in, one ranked board out. Every number on the board is derived from
// the snapshot's own ten fields; no protocol name is ever special-cased and no figure comes from
// outside the file.
//
// How an implied value is built, per pre-token protocol:
//
//   1. Category multiple. Protocols whose token already trades reveal what the market pays per
//      dollar of TVL in their category: ratio = mcap_usd / tvl_usd, winsorised to [0.01, 4] so one
//      freak print cannot bend a category. A category's multiple is the median of its live ratios,
//      shrunk toward the all-market median with a prior weight of 5 observations, so a category
//      priced by one or two tokens leans on the market instead of on a single print. The same
//      shrinkage gives the category's low (25th percentile) and high (75th percentile) multiples,
//      which produce each row's value range.
//   2. Base value = tvl_usd x category multiple.
//   3. Growth: change_7d clamped to [-50, +100] per cent, applied at weight 0.35 and the whole
//      multiplier clamped to [0.60, 1.35]. Unreported growth counts as flat.
//   4. Maturity: a protocol DefiLlama has tracked longer with no token has a longer record behind
//      the estimate: 0.78 + 0.30 x min(age_days, 1460) / 1460. Unknown listing date scores 0.90.
//   5. Breadth: each chain past the first adds 3%, up to +24%: a protocol live on more chains has
//      more surface for a launch to be worth something on.
//
//   implied = round(tvl x multiple x growth x maturity x breadth), at least $1.
//
// Who is ranked: every watchlist slug (the floor, always), plus every other protocol that records
// no token and is a native protocol — not a wrapped, staked or bridged product of a token that
// already trades. The product test is the house's own, applied to the whole list: the Bridge,
// Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC and CEX categories, a name
// carrying the whole word wrapped, staked or staking, a name that begins with an exchange's name,
// or a name ending in a version marker. Products and live-token protocols are set aside and shown
// in the dashboard with the reason, never mixed into the ranking.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's version label, stated on the dashboard. */
export const MODEL_VERSION = 'radar-2';

/** At most this many rows on the board (the gate allows 4,000; the radar stays readable). */
export const BOARD_CAP = 260;

/** Winsorising bounds for one live protocol's mcap/TVL print. */
const RATIO_MIN = 0.01;
const RATIO_MAX = 4;

/** Prior weight, in observations, pulling a category's multiples toward the market's. */
const SHRINK_PRIOR = 5;

/** Growth: clamp the 7-day change, the weight it is applied at, and the multiplier's own clamps. */
const GROWTH_FLOOR_PCT = -50;
const GROWTH_CAP_PCT = 100;
const GROWTH_WEIGHT = 0.35;
const GROWTH_MULT_MIN = 0.6;
const GROWTH_MULT_MAX = 1.35;

/** Maturity: the floor, the range it grows over, and the day count it stops growing at. */
const MATURITY_BASE = 0.78;
const MATURITY_RANGE = 0.3;
const MATURITY_DAYS = 1460;
const MATURITY_UNKNOWN = 0.9;

/** Breadth: per extra chain, and the most it may add. */
const BREADTH_PER_CHAIN = 0.03;
const BREADTH_MAX_EXTRA = 8;

/** One category's live-market multiples: the median and the interquartile pair, after shrinkage. */
export interface CategoryMultiple {
  category: string;
  live_peers: number;
  multiple: number;
  low_multiple: number;
  high_multiple: number;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

const DAY_MS = 86_400_000;

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const PRODUCT_WORDS = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Why a pre-token protocol is a product of a token that already trades, or null when it is native. */
export function productReason(p: SnapshotProtocol): string | null {
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return `${p.category} is a product category: its value rides on a token that already trades`;
  if (PRODUCT_WORDS.test(p.name)) return 'its name marks it as a wrapped or staked product of a token that already trades';
  if (EXCHANGE_PREFIX.test(p.name)) return 'it begins with an exchange name: an exchange product, not a launch of its own';
  if (VERSIONED.test(p.name)) return 'its name ends in a version marker: a later pool of a protocol that already exists';
  return null;
}

/** One live protocol's mcap/TVL print, winsorised; null when it has no usable pair of figures. */
function liveRatio(p: SnapshotProtocol): number | null {
  if (isPreToken(p) || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) return null;
  return Math.min(RATIO_MAX, Math.max(RATIO_MIN, p.mcap_usd / p.tvl_usd));
}

/** The value at fraction `q` of a sorted, non-empty array, by linear interpolation. */
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 1) return sorted[0]!;
  const at = q * (sorted.length - 1);
  const lo = Math.floor(at);
  const hi = Math.min(sorted.length - 1, lo + 1);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo);
}

/** A category figure shrunk toward the market figure by the prior weight. */
function shrunk(own: number, market: number, n: number): number {
  return (n * own + SHRINK_PRIOR * market) / (n + SHRINK_PRIOR);
}

/**
 * The market's multiples, overall and per category, from the snapshot's live-token protocols.
 * Deterministic: ratios are sorted before any percentile is taken, and categories are keyed by name.
 */
export function categoryMultiples(snapshot: Snapshot): { market: CategoryMultiple; byCategory: Map<string, CategoryMultiple> } {
  const all: number[] = [];
  const perCategory = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    const r = liveRatio(p);
    if (r === null) continue;
    all.push(r);
    const key = p.category ?? '(uncategorised)';
    const list = perCategory.get(key);
    if (list === undefined) perCategory.set(key, [r]);
    else list.push(r);
  }
  all.sort((a, b) => a - b);
  const market: CategoryMultiple = {
    category: '(all categories)',
    live_peers: all.length,
    multiple: quantile(all, 0.5),
    low_multiple: quantile(all, 0.25),
    high_multiple: quantile(all, 0.75),
  };
  const byCategory = new Map<string, CategoryMultiple>();
  for (const [category, ratios] of perCategory) {
    ratios.sort((a, b) => a - b);
    byCategory.set(category, {
      category,
      live_peers: ratios.length,
      multiple: shrunk(quantile(ratios, 0.5), market.multiple, ratios.length),
      low_multiple: shrunk(quantile(ratios, 0.25), market.low_multiple, ratios.length),
      high_multiple: shrunk(quantile(ratios, 0.75), market.high_multiple, ratios.length),
    });
  }
  return { market, byCategory };
}

/** The multiples one protocol is priced with: its category's, or the market's when it has none. */
function multiplesFor(p: SnapshotProtocol, table: { market: CategoryMultiple; byCategory: Map<string, CategoryMultiple> }): CategoryMultiple {
  if (p.category === null) return table.market;
  return table.byCategory.get(p.category) ?? table.market;
}

/** The growth multiplier for one 7-day change figure. */
export function growthMultiplier(change7d: number | null): number {
  const pct = Math.min(GROWTH_CAP_PCT, Math.max(GROWTH_FLOOR_PCT, finite(change7d, 0)));
  return Math.min(GROWTH_MULT_MAX, Math.max(GROWTH_MULT_MIN, 1 + (pct / 100) * GROWTH_WEIGHT));
}

/** The maturity multiplier for one age in days. */
export function maturityMultiplier(age: number | null): number {
  if (age === null) return MATURITY_UNKNOWN;
  return MATURITY_BASE + (Math.min(Math.max(age, 0), MATURITY_DAYS) / MATURITY_DAYS) * MATURITY_RANGE;
}

/** The breadth multiplier for a chain count. */
export function breadthMultiplier(chainCount: number): number {
  return 1 + BREADTH_PER_CHAIN * Math.min(Math.max(chainCount - 1, 0), BREADTH_MAX_EXTRA);
}

/** One protocol's full pricing: the implied value, its range, and every multiplier behind it. */
export interface Pricing {
  implied: number;
  low: number;
  high: number;
  multiple: number;
  growth_mult: number;
  maturity_mult: number;
  breadth_mult: number;
  age: number | null;
}

/** Price one pre-token protocol from the snapshot's figures and the multiples table. */
export function price(p: SnapshotProtocol, asOf: string, table: { market: CategoryMultiple; byCategory: Map<string, CategoryMultiple> }): Pricing {
  const m = multiplesFor(p, table);
  const age = ageDays(asOf, p.listed_at);
  const g = growthMultiplier(p.change_7d);
  const mat = maturityMultiplier(age);
  const br = breadthMultiplier(p.chains.length);
  const joint = g * mat * br;
  const implied = Math.max(1, Math.round(p.tvl_usd * m.multiple * joint));
  const low = Math.max(1, Math.min(implied, Math.round(p.tvl_usd * m.low_multiple * joint)));
  const high = Math.max(implied, Math.round(p.tvl_usd * m.high_multiple * joint));
  return { implied, low, high, multiple: m.multiple, growth_mult: g, maturity_mult: mat, breadth_mult: br, age };
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** How expensive one transaction is on a chain, in the words a farmer budgets with. */
function chainCost(chain: string): { gas: string; weekly: string; kind: string } {
  if (chain === 'Ethereum') return { gas: 'about $9 of gas', weekly: 'about $6 of gas a week', kind: 'Ethereum mainnet' };
  if (chain === 'Solana') return { gas: 'under $0.10 of fees', weekly: 'under $0.10 of fees a week', kind: 'Solana' };
  const cheap = ['Base', 'Arbitrum', 'Optimism', 'Polygon', 'Avalanche', 'BNB Chain', 'Gnosis', 'Linea', 'Scroll', 'zkSync Era', 'Blast', 'Mantle', 'Mode', 'Taiko', 'Celo', 'Fantom', 'Sonic', 'Berachain', 'Sui', 'Aptos'];
  if (cheap.includes(chain)) return { gas: 'about $1 of gas', weekly: 'about $1 of gas a week', kind: `${chain} (a low-fee chain)` };
  return { gas: 'about $2 of gas', weekly: 'about $2 of gas a week', kind: chain };
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(tvl: number): number {
  if (tvl >= 1_000_000_000) return 500;
  if (tvl >= 250_000_000) return 250;
  if (tvl >= 50_000_000) return 150;
  if (tvl >= 10_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The two working steps of a category's playbook: the core position, then how it is deepened. */
interface Playbook {
  core: string;
  deepen: string;
  exit: string;
}

/** Category playbooks. {N} is the protocol's name, {C} its first chain, {$} the position's capital. */
const PLAYBOOKS: Record<string, Playbook> = {
  Dexs: {
    core: 'Add ${$} of liquidity to {N}\'s deepest stablecoin or blue-chip pool on {C}, in range if the pool is concentrated, and leave the position open rather than hopping pools.',
    deepen: 'Route a few swaps a week through {N} itself instead of an aggregator, sized $50-$200, so the wallet shows both liquidity and genuine trading volume.',
    exit: 'Remove the liquidity in one transaction; there is no lockup on a standard pool, but withdraw outside volatile hours to limit slippage.',
  },
  Lending: {
    core: 'Supply ${$} of USDC to {N} on {C} as collateral, then borrow about a third of it back in the same asset and re-supply the borrowed part once.',
    deepen: 'Repay and re-borrow a small slice each week so the wallet keeps an active borrow history, and keep the health factor above 1.6 at all times.',
    exit: 'Repay the borrow in full first, then withdraw the collateral; never let the position sit unmonitored while borrowed.',
  },
  CDP: {
    core: 'Open a vault on {N} on {C}: deposit ${$} of the accepted collateral and mint about 40% of its value in the protocol\'s stablecoin.',
    deepen: 'Hold or deploy the minted stablecoin inside {N}\'s own ecosystem (its stability pool or savings rate) instead of selling it, and top the vault up if collateral falls 15%.',
    exit: 'Repay the minted debt, close the vault and withdraw the collateral; keep a buffer so a price dip never liquidates the position.',
  },
  'CDP Manager': {
    core: 'Deposit ${$} of collateral through {N} on {C} and mint the managed stablecoin at a conservative ratio, well inside the liquidation line.',
    deepen: 'Adjust the vault once a week — repay a little or mint a little — so the wallet shows managed, not parked, use of the protocol.',
    exit: 'Repay the debt and close the vault before withdrawing collateral; liquidation is the only real cost in this category.',
  },
  Yield: {
    core: 'Deposit ${$} of USDC into {N}\'s main vault on {C} and keep the vault shares in the farming wallet, unpledged and unlooped.',
    deepen: 'Claim and re-deposit the yield once a week rather than selling it, so the position compounds and the wallet shows repeat deposits.',
    exit: 'Redeem the vault shares; most vaults settle at once, but check for a withdrawal queue before counting on the funds.',
  },
  'Yield Aggregator': {
    core: 'Deposit ${$} into {N}\'s flagship stablecoin vault on {C}; the aggregator routes it, and the shares are the position to hold.',
    deepen: 'Move a small second deposit between two of {N}\'s vaults once a month, so the wallet uses more than one strategy the protocol runs.',
    exit: 'Withdraw from the vault in the app; expect settlement within a day unless the underlying strategy is in a locked farm.',
  },
  'Risk Curators': {
    core: 'Deposit ${$} of USDC into a vault on {N} curated on {C}, choosing the curator with the longest record and the most conservative loan list.',
    deepen: 'Split a second, smaller deposit across a second curator on {N}, and read the curator\'s exposure notes once a week for anything you would not lend to yourself.',
    exit: 'Redeem the vault shares; redemptions follow the underlying loans, so allow a few days and never assume instant exit in a stress week.',
  },
  'Onchain Capital Allocator': {
    core: 'Allocate ${$} into {N}\'s main allocation vault on {C} and hold the shares; the allocator\'s whole product is where the money sits, so the position is the activity.',
    deepen: 'Rebalance once a month between two of {N}\'s allocations, and keep the deposit above the protocol\'s minimum so it is never dust.',
    exit: 'Redeem through the vault; some allocations settle on a cycle, so start the exit a week before the funds are needed elsewhere.',
  },
  Derivatives: {
    core: 'Deposit ${$} of USDC as margin on {N} on {C} and open one small hedged position — long and short the same asset in equal size — so the account trades without directional risk.',
    deepen: 'Roll the hedge once a week and keep total volume steady and modest; a farmer wants a long, ordinary trading history, not one huge day.',
    exit: 'Close both legs, then withdraw the margin; funding payments are the running cost, so do not leave the hedge on unattended for weeks.',
  },
  'Basis Trading': {
    core: 'Put ${$} into {N}\'s basis vault on {C}: the protocol runs the spot-versus-perpetual trade, and holding the vault share is the qualifying position.',
    deepen: 'Add a small top-up once a month and leave distributions in the vault, so the wallet shows a holder compounding, not a passer-by.',
    exit: 'Redeem the share and let the protocol unwind its legs; redemptions can take a settlement cycle, and funding squeezes are the known risk.',
  },
  RWA: {
    core: 'Mint ${$} of {N}\'s yield-bearing asset on {C} after its onboarding check, and hold the asset in the farming wallet for the full holding window.',
    deepen: 'Make a second, smaller mint a month later rather than one lump, and keep the onboarding documents — real-world-asset issuers ask again at redemption.',
    exit: 'Redeem through the issuer; RWA redemptions often run on business days with a queue, so start well before the capital is needed.',
  },
  Chain: {
    core: 'Bridge ${$} to {N}\'s chain and become a user of the chain itself: hold a balance, pay gas in its apps, and make the wallet a resident, not a visitor.',
    deepen: 'Use two or three of the chain\'s own first-party apps each week — a swap, a lend, a mint — since a chain launch rewards breadth of use on its own network.',
    exit: 'Bridge back through the chain\'s official route; official bridges can take days on optimistic designs, so plan the exit early.',
  },
  'Prediction Market': {
    core: 'Fund ${$} on {N} and take small positions in five to ten liquid markets, sized so no single outcome costs more than a tenth of the stake.',
    deepen: 'Trade a little each week in new markets as they open, and let some positions settle rather than selling every one early — settled history is what a market counts.',
    exit: 'Sell or settle open positions, then withdraw; unsettled markets lock their stake until the outcome is final.',
  },
  Payments: {
    core: 'Route ${$} of real payments through {N} on {C} — pay an invoice or a person you actually owe — rather than sending funds in a circle.',
    deepen: 'Keep a standing balance in {N} and use it weekly, so the wallet reads as a payments user with a history, not a single test transfer.',
    exit: 'Withdraw the remaining balance to the wallet; there is no lockup, but keep the payment records with the farm log.',
  },
  Insurance: {
    core: 'Buy ${$} of cover from {N} on {C} against a position you genuinely hold — a lending deposit or a vault share — and keep the policy for its full term.',
    deepen: 'Renew the cover when it lapses and cover a second position if the farm grows; insurers count repeat, real cover, not one-off policies.',
    exit: 'Let the policy run to term; cover is a sunk premium, so the exit is simply not renewing once the farm is done.',
  },
  'Options Vault': {
    core: 'Deposit ${$} into {N}\'s flagship options vault on {C} and hold the shares through at least two full option cycles.',
    deepen: 'Keep the deposit in through a down week as well as an up week; vaults settle weekly, and a holder who stays for several cycles is the user the strategy is built for.',
    exit: 'Request withdrawal before the weekly cycle rolls; shares usually free up at the next settlement, not mid-cycle.',
  },
  Privacy: {
    core: 'Deposit ${$} into {N}\'s shielded pool on {C} in one transaction and leave the note unspent for the holding window; privacy pools reward time in the pool.',
    deepen: 'Make a second, smaller shielded deposit from the same wallet later, and keep meticulous private records — a shielded position has no public trail to reconstruct.',
    exit: 'Unshield to a fresh address you control and keep the deposit note until the funds land; losing the note loses the position.',
  },
  'Staking Pool': {
    core: 'Stake ${$} of the chain\'s staking asset in {N}\'s pool on {C} and hold the pooled position rather than the liquid receipt alone.',
    deepen: 'Restake the rewards into the same pool monthly, and if {N} runs more than one pool, spread a smaller stake into a second one.',
    exit: 'Start the unstake early: staking exits queue behind the chain\'s unbonding period, which can run from days to weeks.',
  },
  Restaking: {
    core: 'Restake ${$} of a liquid staking token through {N} on {C} and hold the restaked position; the layered yield is the point and the layered risk is real.',
    deepen: 'Choose the operator or strategy with the longest record on {N}, and check its slashing terms once a month — restaking penalties are the category\'s known cost.',
    exit: 'Withdraw through {N}\'s queue; restaking exits are slow by design, so begin weeks before the capital is wanted back.',
  },
  'Leveraged Farming': {
    core: 'Open a small leveraged position on {N} on {C} with ${$} of collateral at the lowest leverage offered, farming a stable pair rather than a volatile one.',
    deepen: 'Rebalance the position weekly to keep the leverage where it started; leveraged farms drift, and drift is what liquidates farmers.',
    exit: 'Close the position and repay the borrow in the same session; never leave a leveraged farm open and unmonitored.',
  },
  Farm: {
    core: 'Deposit ${$} into {N}\'s main farm on {C} — the pool the protocol puts first on its own page — and stake the receipt in its rewards contract.',
    deepen: 'Harvest and re-stake the rewards weekly instead of selling them, so the wallet compounds inside {N} rather than exiting through it.',
    exit: 'Unstake, then remove the underlying position; rewards stop the moment the receipt leaves the farm.',
  },
  Indexes: {
    core: 'Mint ${$} of {N}\'s flagship index token on {C} and hold it; an index position is passive by design, so the hold itself is the activity.',
    deepen: 'Add a smaller second mint a month later and hold both through a full rebalance of the index, so the wallet spans the index\'s own cycle.',
    exit: 'Redeem the index token for its components or sell it in its pool; redemption is exact but can cost more gas than a sale.',
  },
  'Liquidity Manager': {
    core: 'Deposit ${$} into {N}\'s managed liquidity vault on {C}; the manager keeps the range, and holding the vault share is the position.',
    deepen: 'Keep the share through several rebalances and add a small top-up after the first month, so the wallet is a holder, not a tester.',
    exit: 'Withdraw from the vault; managed positions settle after the manager unwinds the range, usually within a day.',
  },
  'Uncollateralized Lending': {
    core: 'Lend ${$} to a pool on {N} on {C} only after reading the borrower list — uncollateralized lending pays for credit risk, and the borrowers are named.',
    deepen: 'Split the lend across two pools with different borrowers, and follow the borrowers\' reports monthly; this category\'s losses arrive as defaults, not liquidations.',
    exit: 'Withdraw at the pool\'s term end; most pools lock until maturity, so the exit date is fixed on the day you lend.',
  },
  'Interest Rate Derivatives': {
    core: 'Deposit ${$} into {N}\'s rate market on {C} on the fixed side, locking a known yield for a set term rather than speculating on the rate.',
    deepen: 'Roll into the next term when the first matures, so the wallet shows a continuing user of the rate market across cycles.',
    exit: 'Positions run to their term; early exit means selling the position to the market at its price, so prefer holding to maturity.',
  },
  'OTC Marketplace': {
    core: 'List or take a small ${$} order on {N} on {C} for an asset you are content to hold, and complete the trade through the marketplace\'s own settlement.',
    deepen: 'Trade once a month at ordinary size; an OTC venue counts completed, settled trades, and cancelled listings count for nothing.',
    exit: 'Settled trades are final: the exit is simply holding or selling what you bought, elsewhere or back on {N}.',
  },
  'Crypto Card Issuer': {
    core: 'Load ${$} onto {N}\'s card from {C} and use the card for ordinary spending you would do anyway; a card programme counts real spend, not loads.',
    deepen: 'Keep the card active weekly with small purchases and a standing balance, so the account reads as a customer, not a one-time tester.',
    exit: 'Spend down or withdraw the balance; card balances can carry inactivity terms, so do not leave funds parked indefinitely.',
  },
  'Governance Incentives': {
    core: 'Take part in {N}\'s incentive programme on {C} with ${$} in the position it rewards — read its current rules first, since the programme, not the protocol, defines the qualifying act.',
    deepen: 'Repeat the qualifying act each epoch the programme runs and claim each epoch\'s incentive from {N}\'s own page only.',
    exit: 'When the programme ends, unwind the underlying position as its own category would; unclaimed epochs usually expire.',
  },
  'Dual-Token Stablecoin': {
    core: 'Mint ${$} of {N}\'s stablecoin on {C} against its accepted collateral and hold both sides of the system — the stablecoin and a share of the collateral position.',
    deepen: 'Put the minted stablecoin to work in {N}\'s own stability or savings module, and rebalance monthly to keep the mint ratio steady.',
    exit: 'Redeem the stablecoin and close the collateral position; dual-token systems can depeg under stress, so exit early if the peg wobbles.',
  },
  'Stablecoin Wrapper': {
    core: 'Wrap ${$} of the underlying stablecoin through {N} on {C} and hold the wrapped asset; the wrapper\'s distribution is the position.',
    deepen: 'Use the wrapped asset in one of the venues {N} lists for it, so the wallet shows the asset in circulation, not just minted and idle.',
    exit: 'Unwrap back to the underlying stablecoin; wrappers redeem one-for-one unless the underlying itself is impaired.',
  },
  'Anchor BTC': {
    core: 'Deposit ${$} of BTC (or its wrapped form) into {N} on {C} and hold the anchored position for the full window; bitcoin yield products count time and size.',
    deepen: 'Add a second smaller deposit later rather than moving the first, and keep the source wallet\'s records — BTC positions are often checked against their origin.',
    exit: 'Withdraw through {N}\'s redemption; BTC-side settlements can take a day or more, so do not cut the timing fine.',
  },
  'Decentralized BTC': {
    core: 'Mint or deposit ${$} of bitcoin through {N} on {C} and hold the resulting BTC asset in the farming wallet for the holding window.',
    deepen: 'Use the BTC asset once inside {N}\'s own ecosystem — a lend or a pool — so the wallet shows the asset working, not just minted.',
    exit: 'Redeem back to BTC through the protocol; mint-and-redeem cycles are the known cost, so one round trip is the plan.',
  },
  CeDeFi: {
    core: 'Deposit ${$} into {N}\'s main earn product on {C} and hold it for the stated term; CeDeFi products pay for time locked, so the term is the position.',
    deepen: 'Roll the deposit into a second term when the first ends, and keep the account\'s verification in good standing — these products ask again.',
    exit: 'Withdraw at term end; early exit usually forfeits the yield, so the calendar, not the market, sets the exit.',
  },
};

/** The playbook for a category: its own, or a keyword fallback, or the generic desk plan. */
function playbookFor(category: string | null): Playbook {
  if (category !== null && PLAYBOOKS[category] !== undefined) return PLAYBOOKS[category]!;
  const c = (category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('borrow')) return PLAYBOOKS['Lending']!;
  if (c.includes('dex') || c.includes('swap')) return PLAYBOOKS['Dexs']!;
  if (c.includes('yield') || c.includes('vault')) return PLAYBOOKS['Yield']!;
  if (c.includes('deriv') || c.includes('perpetual') || c.includes('option')) return PLAYBOOKS['Derivatives']!;
  if (c.includes('stak') || c.includes('restak')) return PLAYBOOKS['Staking Pool']!;
  if (c.includes('stable')) return PLAYBOOKS['Dual-Token Stablecoin']!;
  if (c.includes('rwa') || c.includes('real world')) return PLAYBOOKS['RWA']!;
  return {
    core: 'Deposit ${$} of USDC into {N}\'s main product on {C} — the one it puts first on its own page — and keep the position open and untouched.',
    deepen: 'Make one small repeat deposit a month later, so the wallet shows a returning user building a position, not a single test transaction.',
    exit: 'Withdraw through the product\'s own exit; check for a queue or a notice period before assuming the funds are same-day.',
  };
}

/** Fill a playbook line with the protocol's own name, first chain and capital (the {$} placeholder follows a literal $ in the templates, so it takes the bare number). */
function fill(template: string, name: string, chain: string, capital: number): string {
  return template.replaceAll('{N}', name).replaceAll('{C}', chain).replaceAll('{$}', String(capital));
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time, derived from the
 * protocol's own record — its category's playbook, its first chain's fee level, a capital band from
 * its TVL, and a holding window from its age. A second chain, when the protocol has one, is worked
 * into the weekly step.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const cost = chainCost(chain);
  const capital = capitalFor(p.tvl_usd);
  const hold = holdDaysFor(age);
  const weeks = Math.max(4, Math.round(hold / 7));
  const book = playbookFor(p.category);
  const secondChain =
    p.chains.length > 1
      ? ` In week two, repeat the core position at a quarter of the size on ${p.chains[1]!}, the protocol's second chain, so the wallet is active on more than one of its networks.`
      : '';
  return [
    {
      text: `Set up a fresh wallet for ${p.name} alone, fund it only with what this plan uses, and keep its seed phrase written down offline, never in a screenshot or a cloud note.`,
      cost: 'nothing to create; under $3 to fund',
      time: '10 minutes',
    },
    {
      text: `Move $${capital} of working capital onto ${chain} (${cost.kind}), using the bridge or exchange withdrawal ${p.name} itself points to, and keep $20 aside on the same chain for gas.`,
      cost: `${cost.gas} for the transfer in`,
      time: '15 minutes',
    },
    {
      text: fill(book.core, p.name, chain, capital),
      cost: `$${capital} of capital and ${cost.gas}`,
      time: '20 minutes to set up',
    },
    {
      text: fill(book.deepen, p.name, chain, capital),
      cost: 'about $10 of gas across the whole window',
      time: '10 minutes a week',
    },
    {
      text: `Keep a weekly rhythm for ${weeks} weeks: one qualifying action on ${p.name} every week — a deposit, a claim-and-restake, a vote or a small trade — at roughly the same size each time.${secondChain}`,
      cost: cost.weekly,
      time: `10 minutes a week for ${weeks} weeks`,
    },
    {
      text: `Hold the position for at least ${hold} days so the activity spans more than one snapshot of the protocol's books, then check ${p.name}'s own points or rewards page and claim only from a link the protocol itself publishes — never pay a fee to claim an airdrop.`,
      cost: `the $${capital} stays in the position; checking is free`,
      time: `${hold} days holding, 10 minutes to check`,
    },
    {
      text: `Log the wallet, every date and every transaction hash in a farm log as you go. To exit: ${fill(book.exit, p.name, chain, capital)}`,
      cost: 'nothing for the log; exit gas as above',
      time: '5 minutes a week, 20 minutes to exit',
    },
  ];
}

/** One row of board.json: the ranked board's row, with the model's workings on it. */
export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  model: {
    category_multiple: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
  };
  farm_steps: string[];
}

/** The dashboard's view of one board row: everything the page shows, farm plan included. */
export interface RadarRow extends BoardRow {
  farm_plan: FarmStep[];
}

/** A protocol set aside from the ranking, with the reason the page states. */
export interface AsideRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  reason: string;
}

/** Everything the dashboard renders, from the snapshot. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  model_notes: string[];
  market_multiple: CategoryMultiple;
  categories: CategoryMultiple[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  product_size: number;
  rows: RadarRow[];
  live: AsideRow[];
  products: AsideRow[];
}

/** The model's workings, in the plain words the dashboard states them. */
export const MODEL_NOTES: string[] = [
  'Implied value = TVL x category multiple x growth x maturity x breadth, rounded to whole dollars.',
  'The category multiple is what the market already pays per dollar of TVL in that category: the median mcap/TVL of its live-token protocols, each print winsorised to [0.01, 4] and the median shrunk toward the all-market median with a prior weight of 5, so a category priced by one token leans on the market.',
  'The low and high of each row use the same formula with the category\'s 25th and 75th percentile multiples, shrunk the same way: the range is the spread of what comparable tokens actually trade at, not a confidence guess.',
  'Growth clamps the 7-day TVL change to [-50%, +100%] and applies it at weight 0.35, the multiplier itself clamped to [0.60, 1.35]. Maturity runs 0.78 to 1.08 over four years of DefiLlama tracking (unknown listing date: 0.90). Breadth adds 3% per chain past the first, up to +24%.',
  'Wrapped, staked and bridged products of tokens that already trade are set aside, never ranked: a wrapped token is not a launch still to come. Protocols whose token already trades are shown at the market\'s own market cap, not the model\'s.',
];

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const table = categoryMultiples(snapshot);
  const watch = new Set(snapshot.watchlist);
  const chosen: SnapshotProtocol[] = [];
  for (const p of snapshot.protocols) {
    if (!isPreToken(p)) continue;
    if (watch.has(p.slug)) {
      chosen.push(p); // the watchlist is the floor: every slug, whatever its shape
      continue;
    }
    if (productReason(p) !== null) continue; // a product of a traded token is not a launch to come
    chosen.push(p);
  }
  const scored = chosen.map((p) => ({ p, pricing: price(p, snapshot.as_of, table) }));
  scored.sort((a, b) => b.pricing.implied - a.pricing.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.slice(0, BOARD_CAP).map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    watchlist: watch.has(s.p.slug),
    age_days: s.pricing.age,
    implied_value_usd: s.pricing.implied,
    implied_low_usd: s.pricing.low,
    implied_high_usd: s.pricing.high,
    model: {
      category_multiple: round4(s.pricing.multiple),
      growth_multiplier: round4(s.pricing.growth_mult),
      maturity_multiplier: round4(s.pricing.maturity_mult),
      breadth_multiplier: round4(s.pricing.breadth_mult),
    },
    farm_steps: farmSteps(s.p, s.pricing.age).map(stepText),
  }));
}

/** The live-token protocols, by market cap: the market's own values, set aside from the ranking. */
export function liveRows(snapshot: Snapshot): AsideRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p))
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || (a.slug < b.slug ? -1 : 1))
    .slice(0, 40)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      reason: `already trades${p.symbol !== null ? ` as ${p.symbol}` : ''}: shown at its market cap, not ranked`,
    }));
}

/** The pre-token products of traded tokens, set aside with the house's own reasons. */
export function productRows(snapshot: Snapshot): AsideRow[] {
  const watch = new Set(snapshot.watchlist);
  return snapshot.protocols
    .filter((p) => isPreToken(p) && !watch.has(p.slug))
    .map((p) => ({ p, reason: productReason(p) }))
    .filter((x): x is { p: SnapshotProtocol; reason: string } => x.reason !== null)
    .sort((a, b) => b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1))
    .slice(0, 60)
    .map(({ p, reason }) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      reason,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const table = categoryMultiples(snapshot);
  const live = liveRows(snapshot);
  const products = productRows(snapshot);
  const watch = new Set(snapshot.watchlist);
  const stepsBySlug = new Map<string, FarmStep[]>();
  for (const p of snapshot.protocols) {
    if (!isPreToken(p)) continue;
    const row = board.find((r) => r.slug === p.slug);
    if (row !== undefined) stepsBySlug.set(p.slug, farmSteps(p, row.age_days));
  }
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model_notes: MODEL_NOTES,
    market_multiple: table.market,
    categories: [...table.byCategory.values()].sort((a, b) => b.live_peers - a.live_peers || (a.category < b.category ? -1 : 1)),
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !watch.has(r.slug)).length,
    live_size: live.length,
    product_size: products.length,
    rows: board.map((r) => ({ ...r, farm_plan: stepsBySlug.get(r.slug) ?? [] })),
    live,
    products,
  };
  return { board, radar };
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared value, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board holds ${board.length} rows, under the gate's 100`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
