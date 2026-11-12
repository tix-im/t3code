import { CopyValueButton } from "./CopyValueButton";

export function DiffFilePathCopyButton({ filePath }: { filePath: string }) {
  return <CopyValueButton value={filePath} label="Copy file path" tooltip="Copy path" />;
}
