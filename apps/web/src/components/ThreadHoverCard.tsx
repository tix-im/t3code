import type { ComponentProps, ReactNode } from "react";
import { TooltipPopup } from "./ui/tooltip";
import { cn } from "~/lib/utils";

export function ThreadHoverCardPopup({ className, ...props }: ComponentProps<typeof TooltipPopup>) {
  return (
    <TooltipPopup
      {...props}
      variant="glass"
      className={cn("max-w-80 text-left whitespace-normal", className)}
    />
  );
}

export function ThreadHoverCard({
  title,
  children,
  footer,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Pair with a wider popup. The title wraps instead of cropping. */
  wide?: boolean;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-2 px-1 py-2", wide ? "max-w-96" : "max-w-80")}>
      <div
        className={cn(
          "min-w-0 text-xs leading-tight font-medium text-foreground",
          wide ? "wrap-anywhere" : "truncate",
        )}
      >
        {title}
      </div>
      <div className="grid gap-1.5 pl-0.5 text-xs text-muted-foreground">{children}</div>
      {footer}
    </div>
  );
}
