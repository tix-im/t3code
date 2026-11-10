import {
  TiximWorkflowRelationship,
  type EnvironmentId,
  type ThreadId,
  type TiximWorkflowConnection,
  type TiximWorkflowRun,
} from "@t3tools/contracts";
import { ChevronDownIcon, RefreshCwIcon } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Button,
  cn,
  Command,
  CommandInput,
  CommandItem,
  CommandList,
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
  Spinner,
  useEnvironmentQuery,
} from "../../src/plugins/host";
import { workflowEnvironment } from "./state";
import { WorkflowTally } from "./WorkflowTally";
import {
  WORKFLOW_RELATIONSHIP_LABELS,
  WORKFLOW_TONE_CLASS,
  workflowRunKey,
  workflowRunTitle,
  workflowStateGlyph,
  workflowStepCounts,
} from "./workflowPresentation";

const HISTORY_MIN_QUERY_LENGTH = 3;
const HISTORY_RECENT_MATCH_LIMIT = 20;
const MAX_VISIBLE_RESULTS = 40;

/** Keeps the previous answer on screen while the next query is in flight. */
function useHeldRuns(runs: ReadonlyArray<TiximWorkflowRun> | null, scope: string) {
  const [held, setHeld] = useState<{
    scope: string;
    runs: ReadonlyArray<TiximWorkflowRun>;
  } | null>(null);
  if (runs !== null && (held?.runs !== runs || held.scope !== scope)) setHeld({ scope, runs });
  return runs ?? (held?.scope === scope ? held.runs : null);
}

function connectionStatus(connection: TiximWorkflowConnection): string {
  return connection.loading ? "Checking…" : connection.available ? "Connected" : "Unavailable";
}

function ResultRow({ run, attaching }: { run: TiximWorkflowRun; attaching: boolean }) {
  const glyph = workflowStateGlyph(run.state);
  const { icon: Icon } = glyph;
  return (
    <>
      {attaching ? (
        <Spinner size="sm" tone="muted" className="shrink-0" />
      ) : (
        <Icon aria-hidden className={cn("size-3.5 shrink-0", WORKFLOW_TONE_CLASS[glyph.tone])} />
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm leading-4 text-foreground/85">
          {workflowRunTitle(run)}
        </span>
        <span className="truncate text-2xs leading-4 text-muted-foreground">
          {run.hid ?? run.runId}
          <span className="sr-only">, {glyph.label}</span>
        </span>
      </span>
      <span className="shrink-0 text-2xs">
        <WorkflowTally counts={workflowStepCounts(run.steps)} />
      </span>
    </>
  );
}

function Note({ children, alert = false }: { children: React.ReactNode; alert?: boolean }) {
  return (
    <p
      role={alert ? "alert" : undefined}
      className={cn(
        "px-3 py-2 text-xs",
        alert ? "text-destructive-foreground" : "text-muted-foreground",
      )}
    >
      {children}
    </p>
  );
}

export function WorkflowAttachPicker({
  environmentId,
  threadId,
  connections,
  connectionsError,
  connectionsLoading,
  attached,
  attachingKey,
  error,
  onAttach,
  onRefresh,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  connections: ReadonlyArray<TiximWorkflowConnection>;
  connectionsError: string | null;
  connectionsLoading: boolean;
  attached: ReadonlyArray<TiximWorkflowRun>;
  attachingKey: string | null;
  error: string | null;
  onAttach: (run: TiximWorkflowRun, relationship: TiximWorkflowRelationship) => void;
  onRefresh: () => void;
}) {
  const [connectionId, setConnectionId] = useState("");
  const [query, setQuery] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [relationship, setRelationship] = useState<TiximWorkflowRelationship>("untracked");
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Own the debounce timer while the search input changes or unmounts.
  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(query.trim()), 200);
    return () => clearTimeout(timer);
  }, [query]);

  const connection =
    connections.find((value) => value.id === connectionId) ??
    connections.find((value) => value.available) ??
    connections[0];
  const currentConnection = connection?.id ?? "";
  // A search reads the daemon directly, so it need not wait for the thread's own snapshot.
  const searchable =
    connection !== undefined && (connection.available || connection.loading === true);
  const searchAtom = (input: { query: string; mentionedOnly: boolean; includeHistory?: boolean }) =>
    workflowEnvironment.tiximWorkflowSearch({
      environmentId,
      input: { threadId, connectionId: currentConnection, ...input },
    });

  const recent = useEnvironmentQuery(
    searchable ? searchAtom({ query: searchQuery, mentionedOnly: false }) : null,
  );
  const mentioned = useEnvironmentQuery(
    searchable && searchQuery === "" ? searchAtom({ query: "", mentionedOnly: true }) : null,
  );
  const recentRuns = useHeldRuns(recent.data?.runs ?? null, currentConnection);
  const searchesHistory =
    searchable &&
    searchQuery.length >= HISTORY_MIN_QUERY_LENGTH &&
    recent.data !== null &&
    recent.data.runs.length < HISTORY_RECENT_MATCH_LIMIT;
  const history = useEnvironmentQuery(
    searchesHistory
      ? searchAtom({ query: searchQuery, mentionedOnly: false, includeHistory: true })
      : null,
  );

  const seen = new Set(attached.map(workflowRunKey));
  const unseen = (runs: ReadonlyArray<TiximWorkflowRun>) =>
    runs.filter((run) => {
      const key = workflowRunKey(run);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const sections =
    searchQuery === ""
      ? [
          { title: "Mentioned in this chat", runs: unseen(mentioned.data?.runs ?? []) },
          { title: "Recent", runs: unseen(recentRuns ?? []).slice(0, MAX_VISIBLE_RESULTS) },
        ]
      : [
          {
            title: null,
            runs: unseen([...(recentRuns ?? []), ...(history.data?.runs ?? [])]).slice(
              0,
              MAX_VISIBLE_RESULTS,
            ),
          },
        ];
  const results = sections.flatMap((section) => section.runs);
  const keys = results.map(workflowRunKey);

  const typing = query.trim() !== searchQuery;
  const firstSearch = searchable && recentRuns === null && recent.error === null;
  const stale = typing || recent.isPending;
  const refining = !firstSearch && stale;
  const searchingHistory = searchesHistory && history.isPending;
  const searchError = recent.error;
  const label = connection?.label ?? "";

  let body: React.ReactNode;
  if (connectionsError !== null && connections.length === 0) {
    body = (
      <div className="flex flex-col items-start gap-1 pb-2">
        <Note alert>{connectionsError}</Note>
        <Button className="mx-2" size="xs" variant="ghost" onClick={onRefresh}>
          <RefreshCwIcon aria-hidden /> Retry
        </Button>
      </div>
    );
  } else if (connection === undefined) {
    body = connectionsLoading ? (
      <p className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
        <Spinner size="xs" /> Loading connections…
      </p>
    ) : (
      <Note>Add a Tixim connection in Settings.</Note>
    );
  } else if (!searchable) {
    body = (
      <div className="flex flex-col items-start gap-1 pb-2">
        <Note alert>
          {label}:{" "}
          {connection.error ?? "Connection unavailable. Check the connection and your permissions."}
        </Note>
        <Button className="mx-2" size="xs" variant="ghost" onClick={onRefresh}>
          <RefreshCwIcon aria-hidden /> Retry connection
        </Button>
      </div>
    );
  } else if (searchError !== null && results.length === 0) {
    body = <Note alert>{searchError}</Note>;
  } else if (firstSearch) {
    body = (
      <p className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
        <Spinner size="xs" /> Searching {label}…
      </p>
    );
  } else if (results.length === 0 && !typing && !recent.isPending && !searchingHistory) {
    body = (
      <Note>
        {searchQuery
          ? `No runs match "${searchQuery}" on ${label}.`
          : `No recent runs on ${label}.`}
      </Note>
    );
  } else {
    body = (
      <CommandList className="max-h-72 overflow-y-auto">
        {sections.map((section) =>
          section.runs.length === 0 ? null : (
            <div key={section.title ?? "matches"}>
              {section.title ? (
                <div className="px-2 pt-1.5 pb-1 text-2xs font-medium text-muted-foreground select-none">
                  {section.title}
                </div>
              ) : null}
              {section.runs.map((run) => {
                const key = workflowRunKey(run);
                return (
                  <CommandItem
                    key={key}
                    value={key}
                    disabled={attachingKey !== null}
                    onClick={(event) => {
                      // Enter clicks the highlighted row, which is left over until this query answers.
                      if (event.detail === 0 && stale) return;
                      onAttach(run, relationship);
                    }}
                  >
                    <ResultRow run={run} attaching={attachingKey === key} />
                  </CommandItem>
                );
              })}
            </div>
          ),
        )}
        {searchingHistory ? (
          <p className="flex items-center gap-2 px-2 py-1.5 text-2xs text-muted-foreground">
            <Spinner size="xs" /> Searching older runs…
          </p>
        ) : null}
      </CommandList>
    );
  }

  return (
    <Command mode="none" items={keys} value={query} onValueChange={setQuery}>
      <div className="relative">
        <CommandInput aria-label="Search workflow runs" placeholder="Search runs by name or ID" />
        {refining ? <Spinner size="xs" tone="muted" className="absolute top-4 right-3.5" /> : null}
      </div>
      {body}
      {error ? <Note alert>{error}</Note> : null}
      <div className="flex items-center justify-between gap-2 border-t border-border/65 px-1.5 py-1">
        <Menu>
          <MenuTrigger render={<Button size="xs" variant="ghost" />}>
            Attach as {WORKFLOW_RELATIONSHIP_LABELS[relationship]}
            <ChevronDownIcon aria-hidden />
          </MenuTrigger>
          <MenuPopup align="start">
            <MenuRadioGroup
              value={relationship}
              onValueChange={(value: TiximWorkflowRelationship) => setRelationship(value)}
              aria-label="Relationship to this chat"
            >
              {TiximWorkflowRelationship.literals.map((value) => (
                <MenuRadioItem key={value} value={value} closeOnClick>
                  {WORKFLOW_RELATIONSHIP_LABELS[value]}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuPopup>
        </Menu>
        <Menu>
          <MenuTrigger render={<Button size="xs" variant="ghost" aria-label="Tixim connection" />}>
            <span
              aria-hidden
              className={cn(
                "size-1.5 rounded-full",
                connection?.loading
                  ? "bg-warning"
                  : connection?.available
                    ? "bg-success"
                    : "bg-destructive",
              )}
            />
            <span className="max-w-28 truncate">{label || "No connection"}</span>
            <ChevronDownIcon aria-hidden />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuRadioGroup
              value={currentConnection}
              onValueChange={(id: string) => {
                setConnectionId(id);
                const next = connections.find((value) => value.id === id);
                if (next && !next.available && !next.loading) onRefresh();
              }}
              aria-label="Tixim connections"
            >
              {connections.map((value) => (
                <MenuRadioItem key={value.id} value={value.id} closeOnClick>
                  <span className="block">{value.label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {connectionStatus(value)}
                  </span>
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
            {connections.length === 0 ? <MenuItem disabled>No connections</MenuItem> : null}
            <MenuSeparator />
            <MenuItem disabled={connectionsLoading} onClick={onRefresh}>
              <RefreshCwIcon aria-hidden /> Reload connections
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>
    </Command>
  );
}
