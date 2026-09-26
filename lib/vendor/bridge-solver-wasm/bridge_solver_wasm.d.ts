/* tslint:disable */
/* eslint-disable */

/**
 * Double-dummy analysis with a session-lived position cache.
 */
export class Analyzer {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Forget every cached position, and hand the solver's pooled memory back
     * to the allocator.
     *
     * The two are separate stores and only one of them is obvious. Beyond this
     * position cache, the solver keeps a free list of pattern-tree blocks that
     * it recycles rather than freeing, which is right for a process solving
     * deal after deal and wrong for a browser tab. A freakish distribution --
     * voids in several hands -- can build a pattern tree of fifteen million
     * nodes and over a gigabyte of blocks, and without this that peak is held
     * for as long as the page is open, on a heap that is capped at four
     * gigabytes and in practice cut off well below it.
     */
    clear_cache(): void;
    /**
     * A double-dummy-perfect continuation from one point in the hand.
     *
     * What should have happened from `from` onwards, with both sides playing
     * optimally. Started at the first costed error, it is the correction for it.
     *
     * Done in one call rather than by walking `dd_play_node` forward: the work is
     * the same shape, but the caches live for the whole playout instead of being
     * rebuilt per position, and one call replaces forty round trips.
     */
    dd_optimal_line(request_json: string, from: number): string;
    /**
     * Tier 1: the running trace — every played card with its double-dummy cost.
     *
     * This is what tags each error card. `request_json` matches the service's
     * `POST /dd/play` body. Positions solved here are remembered, so stepping
     * forward through a hand only pays for the newly reached position.
     */
    dd_play(request_json: string): string;
    /**
     * Tier 2: the alternatives at one decision node, with each card's cost.
     *
     * This is what a click on a tagged card shows. `node` is a 0-based index
     * into `plays`.
     */
    dd_play_node(request_json: string, node: number): string;
    /**
     * Solve the full 20-cell double-dummy table for a deal.
     *
     * `dealstr` is PBN, e.g. `"N:J98.QT83.K6.J853 Q762..."`. Returns
     * `{ tricks, total }` as JSON, rows `N,E,S,W` and columns `C,D,H,S,NT`.
     */
    dd_table(dealstr: string): string;
    /**
     * Create an analyzer with an empty cache.
     */
    constructor();
    /**
     * How many positions are currently cached.
     */
    readonly cached_positions: number;
}

export function parse_lin(input: string): string;

/**
 * Parse a multi-board LIN file, one board per line.
 *
 * Returns a JSON array with one entry per board, each either
 * `{ "ok": <parsed board> }` or `{ "error": "<why>" }`, so one unanalysable
 * board — a passed-out auction, say — does not cost the caller the rest of the
 * file.
 */
export function parse_lin_file(content: string): string;

/**
 * Turn a LIN string or a BBO handviewer URL into an analysable request.
 *
 * Accepts either form — a URL is recognised by its `lin=` parameter — and
 * returns JSON carrying a `request` ready for [`Analyzer::dd_play`] alongside
 * the contract, seat names, auction and claim a UI wants to display. Nothing
 * is fetched: a URL is decoded locally, so a shortened link must be expanded
 * before it gets here.
 * Hand the solver's pooled pattern-tree memory back to the allocator.
 *
 * Available without an [`Analyzer`], because the pool is per-thread and global
 * to the module: a caller that only ever asked for `dd_table` still has one.
 * Worth calling after a hard deal, or on a page-visibility change.
 */
export function release_memory(): void;

/**
 * Solve one position: how many tricks the declaring side takes from the lead.
 *
 * A convenience for callers that want a single number and no play trace.
 */
export function solve_contract(dealstr: string, trump: string, leader: string): number;

/**
 * Turn Rust panics into readable console messages rather than `unreachable`.
 */
export function start(): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_analyzer_free: (a: number, b: number) => void;
    readonly analyzer_cached_positions: (a: number) => number;
    readonly analyzer_clear_cache: (a: number) => void;
    readonly analyzer_dd_optimal_line: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly analyzer_dd_play: (a: number, b: number, c: number) => [number, number, number, number];
    readonly analyzer_dd_play_node: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly analyzer_dd_table: (a: number, b: number, c: number) => [number, number, number, number];
    readonly analyzer_new: () => number;
    readonly parse_lin: (a: number, b: number) => [number, number, number, number];
    readonly parse_lin_file: (a: number, b: number) => [number, number, number, number];
    readonly solve_contract: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly start: () => void;
    readonly release_memory: () => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
