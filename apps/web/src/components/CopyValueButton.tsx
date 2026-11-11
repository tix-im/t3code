import { CheckIcon, CopyIcon } from "lucide-react";
import { useRef, type SyntheticEvent } from "react";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import {
  ANCHORED_COPY_TOAST_TIMEOUT_MS,
  showAnchoredCopyErrorToast,
  showAnchoredCopySuccessToast,
} from "./ui/anchoredCopyToast";
import { Button } from "./ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

// Copy buttons sit inside clickable rows and options, which must not also activate.
const stop = (event: SyntheticEvent) => event.stopPropagation();

export function CopyValueButton({
  value,
  label,
  tooltip = "Copy",
}: {
  value: string;
  /** Accessible name, such as "Copy file path". */
  label: string;
  tooltip?: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const { copyToClipboard, isCopied } = useCopyToClipboard<void>({
    onCopy: () => showAnchoredCopySuccessToast(ref),
    onError: (error) => showAnchoredCopyErrorToast(ref, error),
    timeout: ANCHORED_COPY_TOAST_TIMEOUT_MS,
  });

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            ref={ref}
            size="icon-micro"
            variant="ghost-muted"
            aria-label={label}
            onPointerDown={stop}
            onMouseDown={stop}
            onClick={(event) => {
              event.stopPropagation();
              event.preventDefault();
              copyToClipboard(value, undefined);
            }}
          />
        }
      >
        {isCopied ? <CheckIcon className="size-3 text-success" /> : <CopyIcon className="size-3" />}
      </TooltipTrigger>
      <TooltipPopup>
        <p>{isCopied ? "Copied" : tooltip}</p>
      </TooltipPopup>
    </Tooltip>
  );
}
