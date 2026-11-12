import {
  type EnvironmentId,
  type ThreadId,
  TiximWorkflowRelationship,
  type TiximWorkflowRun,
} from "@t3tools/contracts";
import {
  ArrowUpRightIcon,
  BanIcon,
  CopyIcon,
  EllipsisIcon,
  LinkIcon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  ScrollTextIcon,
  SnowflakeIcon,
  SunIcon,
  UnlinkIcon,
  WorkflowIcon,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import {
  cn,
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
  THREAD_DETAILS_PANEL_ICON_CLASS,
  ThreadDetailsControl,
  ThreadHoverCardPopup,
  Tooltip,
  TooltipTrigger,
  useNowMinute,
  writeTextToClipboard,
} from "../../src/plugins/host";
import { WorkflowRunDetails } from "./WorkflowRunDetails";
import { WorkflowRunLog } from "./WorkflowRunLog";
import {
  allowedWorkflowRunActions,
  WORKFLOW_RUN_ACTION_LABELS,
  type WorkflowRunAction,
} from "./workflowActions";
import { WorkflowProgressBar } from "./WorkflowProgressBar";
import { WorkflowTally } from "./WorkflowTally";
import { WORKFLOW_TREE_INDENT, WorkflowTreeGuides } from "./WorkflowTreeGuides";
import {
  isFinishedWorkflowState,
  WORKFLOW_RELATIONSHIP_LABELS,
  WORKFLOW_TONE_CLASS,
  workflowReportCounts,
  workflowRunElapsed,
  workflowRunNote,
  workflowRunTitle,
  workflowStateGlyph,
  workflowStepCounts,
  workflowStepProgress,
  type OrderedWorkflowRun,
} from "./workflowPresentation";

const ACTION_ICONS: Record<WorkflowRunAction, LucideIcon> = {
  suspend: PauseIcon,
  resume: PlayIcon,
  freeze: SnowflakeIcon,
  thaw: SunIcon,
  restart: RotateCcwIcon,
  cancel: BanIcon,
};

export function WorkflowRunRow({
  environmentId,
  threadId,
  run,
  tree,
  refreshing,
  busy,
  onOpen,
  onRelationshipChange,
  onDetach,
  onAction,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  run: TiximWorkflowRun;
  tree: OrderedWorkflowRun;
  /** The daemon has not answered yet, so the saved state is shown rather than "unavailable". */
  refreshing: boolean;
  busy: boolean;
  onOpen: (run: TiximWorkflowRun) => void;
  onRelationshipChange: (run: TiximWorkflowRun, relationship: TiximWorkflowRelationship) => void;
  onDetach: (run: TiximWorkflowRun) => void;
  onAction: (run: TiximWorkflowRun, action: WorkflowRunAction) => void;
}) {
  const nowSeconds = Date.parse(`${useNowMinute()}:00Z`) / 1000;
  const available = run.availability === "available";
  const known = available || refreshing;
  const glyph = workflowStateGlyph(known ? run.state : "unavailable");
  const { icon: Icon } = glyph;
  const title = workflowRunTitle(run);
  const elapsed = known ? workflowRunElapsed(run, nowSeconds) : null;
  const steps = workflowStepCounts(run.steps);
  const reports = workflowReportCounts(run.reports);
  const note = known ? workflowRunNote(run) : null;
  const NoteIcon = note?.icon;
  const progress =
    known && !isFinishedWorkflowState(run.state) ? workflowStepProgress(run.steps) : null;
  const [logOpen, setLogOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const actions = available ? allowedWorkflowRunActions(run.state) : [];
  return (
    <li
      className="group relative flex flex-wrap items-center rounded-lg"
      onContextMenu={(event) => {
        if (busy) return;
        event.preventDefault();
        event.stopPropagation();
        setMenuPosition({ x: event.clientX, y: event.clientY });
        setMenuOpen(true);
      }}
      style={tree.depth > 0 ? { paddingInlineStart: tree.depth * WORKFLOW_TREE_INDENT } : undefined}
    >
      <WorkflowTreeGuides entry={tree} iconCenterY={14} />
      <Tooltip open={hovered && !menuOpen} onOpenChange={setHovered}>
        <TooltipTrigger
          delay={200}
          render={
            <ThreadDetailsControl
              size="sm"
              variant="ghost"
              part="row"
              multiline
              aria-disabled={available ? undefined : true}
              onClick={() => {
                if (available) onOpen(run);
              }}
            />
          }
        >
          <Icon
            aria-hidden
            className={cn("mt-0.5 size-4 shrink-0 self-start", WORKFLOW_TONE_CLASS[glyph.tone])}
          />
          {/* The end padding keeps text clear of the row menu. */}
          <span className="flex min-w-0 flex-1 flex-col gap-0.5 pe-6">
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-medium leading-4 text-foreground/85">
                {title}
              </span>
              <span className="sr-only">{glyph.label}</span>
              {elapsed ? (
                <span className="shrink-0 text-2xs font-normal leading-4 tabular-nums text-muted-foreground">
                  {elapsed}
                </span>
              ) : null}
            </span>
            {progress ? <WorkflowProgressBar {...progress} /> : null}
            {steps.length > 0 || reports.length > 0 ? (
              <span className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 text-2xs font-normal leading-4">
                <WorkflowTally counts={steps} />
                <WorkflowTally counts={reports} noun="reports" />
              </span>
            ) : null}
            {note && NoteIcon ? (
              <span
                className={cn(
                  "flex min-w-0 items-center gap-1 text-2xs font-normal leading-4",
                  WORKFLOW_TONE_CLASS[note.tone],
                )}
              >
                <NoteIcon aria-hidden className="size-3 shrink-0" />
                <span className="min-w-0 truncate">{note.text}</span>
              </span>
            ) : null}
          </span>
        </TooltipTrigger>
        <ThreadHoverCardPopup side="left" className="pointer-events-auto max-w-96">
          <WorkflowRunDetails
            run={run}
            glyph={glyph}
            elapsed={elapsed}
            attached
            footer={
              available ? (
                <div className="border-t border-border/65 pt-1">
                  <ThreadDetailsControl
                    size="sm"
                    variant="ghost"
                    part="row"
                    onClick={() => {
                      setHovered(false);
                      onOpen(run);
                    }}
                  >
                    <WorkflowIcon aria-hidden className={THREAD_DETAILS_PANEL_ICON_CLASS} />
                    <span className="min-w-0 flex-1 truncate text-start">Open workflow</span>
                    <ArrowUpRightIcon
                      aria-hidden
                      className="size-3 shrink-0 text-muted-foreground"
                    />
                  </ThreadDetailsControl>
                </div>
              ) : undefined
            }
          />
        </ThreadHoverCardPopup>
      </Tooltip>
      <div className="pointer-events-none absolute top-1 right-1 opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 has-[[data-popup-open]]:pointer-events-auto has-[[data-popup-open]]:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100">
        <Menu
          open={menuOpen}
          onOpenChange={(open) => {
            setMenuOpen(open);
            if (!open) setMenuPosition(null);
          }}
        >
          <MenuTrigger
            render={
              <ThreadDetailsControl
                size="icon-xs"
                variant="ghost"
                part="icon"
                disabled={busy}
                aria-label={`Manage ${title}`}
              />
            }
          >
            <EllipsisIcon aria-hidden className="size-3.5" />
          </MenuTrigger>
          <MenuPopup
            anchor={
              menuPosition
                ? {
                    getBoundingClientRect: () => new DOMRect(menuPosition.x, menuPosition.y, 0, 0),
                  }
                : undefined
            }
            align={menuPosition ? "start" : "end"}
            sideOffset={menuPosition ? 0 : 4}
          >
            <MenuItem
              onClick={() => void writeTextToClipboard(run.hid ?? run.runId, "workflow ID")}
            >
              <CopyIcon />
              Copy ID
            </MenuItem>
            {actions.length > 0 ? <MenuSeparator /> : null}
            {actions.map((action) => {
              const ActionIcon = ACTION_ICONS[action];
              return (
                <MenuItem
                  key={action}
                  variant={action === "cancel" ? "destructive" : "default"}
                  onClick={() => onAction(run, action)}
                >
                  <ActionIcon />
                  {WORKFLOW_RUN_ACTION_LABELS[action]}
                  {action === "cancel" || action === "restart" ? "…" : null}
                </MenuItem>
              );
            })}
            <MenuSeparator />
            <MenuItem disabled={!available} onClick={() => setLogOpen((value) => !value)}>
              <ScrollTextIcon />
              {logOpen ? "Hide log" : "Show log"}
            </MenuItem>
            <MenuSub>
              <MenuSubTrigger disabled={!available}>
                <LinkIcon />
                {WORKFLOW_RELATIONSHIP_LABELS[run.relationship]}
              </MenuSubTrigger>
              <MenuSubPopup>
                <MenuRadioGroup
                  value={run.relationship}
                  onValueChange={(value: TiximWorkflowRelationship) =>
                    onRelationshipChange(run, value)
                  }
                  aria-label="Relationship to this chat"
                >
                  {TiximWorkflowRelationship.literals.map((value) => (
                    <MenuRadioItem key={value} value={value} closeOnClick>
                      {WORKFLOW_RELATIONSHIP_LABELS[value]}
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
              </MenuSubPopup>
            </MenuSub>
            <MenuItem onClick={() => onDetach(run)}>
              <UnlinkIcon />
              Detach
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>
      {logOpen && available ? (
        <div className="basis-full">
          <WorkflowRunLog environmentId={environmentId} threadId={threadId} run={run} />
        </div>
      ) : null}
    </li>
  );
}
