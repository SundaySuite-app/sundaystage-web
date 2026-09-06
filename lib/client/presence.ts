/**
 * Presence over the leader-tab election (lib/client/leader.ts).
 *
 * THE PROBLEM: the display read path was de-duplicated in August — one leader
 * tab per join code holds the Supabase subscription and the polling, the rest
 * render what it relays. Presence was left out and kept opening ONE Supabase
 * connection PER TAB. Three projector tabs on one PC therefore still cost three
 * presence connections against the Pro cap, to say the same thing three times.
 *
 * THE FIX: the same election, nothing new. The leader of a presence group alone
 * holds the connection: it tracks itself and relays the roster it syncs to its
 * followers over BroadcastChannel; followers hold no connection and render the
 * relayed roster. When the leader closes gracefully its `bye` promotes the next
 * tab at once; when it crashes its id ages out of everyone's peer set after
 * `PEER_TIMEOUT_MS` and the next-smallest promotes and opens the connection in
 * its place. No BroadcastChannel → every tab is its own leader and holds its
 * own connection, which is exactly the behaviour before this file existed.
 *
 * WHY (session, role) GROUPS AND NOT SESSION ALONE: presence is what the
 * operator page counts ("2 skjermer · 13 mobiler"). Two tabs are interchangeable
 * only when they are the same KIND of viewer of the same session, so a display
 * tab and the operator tab in one browser must not collapse into each other —
 * that would not be fewer connections for the same information, it would be
 * less information. Grouping by role collapses true duplicates and nothing else.
 *
 * WHAT DOES CHANGE: N tabs of one machine showing the same session in the same
 * role now count as one viewer instead of N. That is the point — the connection
 * IS the viewer — and it is the same trade the display path already made. A tab
 * that opens into an existing group also connects for the one heartbeat before
 * it hears the sitting leader, so the operator's count can blip by one and
 * settle; a brief double connection during handover is the same cost the
 * display election already accepts, and a permanently leaderless group (no
 * presence at all) is the failure that matters.
 *
 * Transport-, clock- and connection-agnostic like the coordinator it wraps
 * (inject `post`, `now` and `connect`, drive with `tick()`) so handover is
 * unit-testable in the node env against a fake bus and a fake connection.
 */
import { LeaderCoordinator, type LeaderMessage } from "./leader";

export interface PresenceViewer {
  viewerId: string;
  role: "display" | "follow" | "operator" | "scene";
}

/** An observer that tracks nothing (usePresence called with `self: null`). */
export type PresenceRole = PresenceViewer["role"] | "obs";

/** Messages on a presence group's BroadcastChannel: the election's, with the
 *  roster as the relayed payload. */
export type PresenceMessage = LeaderMessage<PresenceViewer[]>;

/** The one open presence connection. Closed when this tab stops leading. */
export interface PresenceLink {
  close(): void;
}

/**
 * BroadcastChannel name for one presence group. Same session AND same role, so
 * only true duplicates share a leader (see the file header). Distinct from the
 * display path's `stage-leader:<code>` channel: that one is keyed by join code
 * and carries frames, this one is keyed by session id and carries rosters.
 */
export function presenceChannelName(sessionId: string, role: PresenceRole): string {
  return `stage-presence:${sessionId}:${role}`;
}

export interface PresenceControllerOptions {
  /** This tab's id. Must be unique per tab and give a stable total order. */
  selfId: string;
  now: () => number;
  post: (msg: PresenceMessage) => void;
  /** Open the real presence connection. LEADER ONLY: called on promotion,
   *  closed on demotion and on stop. `onRoster` fires on every presence sync. */
  connect: (onRoster: (viewers: PresenceViewer[]) => void) => PresenceLink;
  /** The roster this tab should show — its own syncs while it leads, the
   *  leader's relays while it follows. */
  onRoster: (viewers: PresenceViewer[]) => void;
  /** Interval a live peer may miss beats before it is presumed dead. */
  peerTimeoutMs?: number;
}

export class PresenceController {
  private readonly coord: LeaderCoordinator<PresenceViewer[]>;
  private readonly connect: (onRoster: (viewers: PresenceViewer[]) => void) => PresenceLink;
  private readonly onRoster: (viewers: PresenceViewer[]) => void;

  private link: PresenceLink | null = null;
  /** Last roster this tab knows. `null` = nothing synced or relayed yet, which
   *  is what stops a freshly promoted leader from catching a follower up with an
   *  empty roster over the perfectly good one it already has. */
  private roster: PresenceViewer[] | null = null;
  private stopped = false;

  constructor(opts: PresenceControllerOptions) {
    this.connect = opts.connect;
    this.onRoster = opts.onRoster;
    this.coord = new LeaderCoordinator<PresenceViewer[]>({
      selfId: opts.selfId,
      now: opts.now,
      post: opts.post,
      peerTimeoutMs: opts.peerTimeoutMs,
      onLeadershipChange: (leader) => (leader ? this.openLink() : this.closeLink()),
      onRelay: (viewers) => {
        this.roster = viewers;
        this.onRoster(viewers);
      },
      onNeedState: () => this.roster,
    });
  }

  /** True while this tab holds the group's one presence connection. */
  get holdsConnection(): boolean {
    return this.link !== null;
  }

  get isLeader(): boolean {
    return this.coord.isLeader;
  }

  /** The id this tab currently believes leads (its own when it leads). */
  get leaderId(): string | null {
    return this.coord.leaderId;
  }

  /** Announce presence and settle the initial election (solo tab → leader,
   *  which opens the connection synchronously). */
  start(): void {
    this.coord.start();
  }

  /** Periodic: beat, age out dead peers, re-settle — and open or close the
   *  connection if that changed who leads. */
  tick(): void {
    this.coord.tick();
  }

  receive(msg: PresenceMessage): void {
    this.coord.receive(msg);
  }

  /** Graceful departure — peers promote immediately instead of on timeout. */
  resign(): void {
    this.coord.resign();
  }

  /** Tear down: the connection first, so a closing tab never leaves the group's
   *  socket open behind it. */
  stop(): void {
    this.stopped = true;
    this.closeLink();
    this.coord.stop();
  }

  private openLink(): void {
    if (this.stopped || this.link) return;
    this.link = this.connect((viewers) => {
      this.roster = viewers;
      this.onRoster(viewers);
      // Followers render exactly what the leader synced — one connection's view
      // of the session, shown by every tab of it.
      this.coord.relay(viewers);
    });
  }

  private closeLink(): void {
    this.link?.close();
    this.link = null;
    // The last roster stays on screen on purpose: a demoted tab is about to be
    // caught up by the new leader, and blanking the counts in between would read
    // to the operator as "everyone just left".
  }
}
