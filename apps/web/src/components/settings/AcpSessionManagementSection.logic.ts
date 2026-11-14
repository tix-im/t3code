interface LabeledProject<Id extends string> {
  readonly id: Id;
  readonly title: string;
  readonly workspaceRoot: string;
}

function lastPathSegment(path: string) {
  return path.split(/[\\/]+/).findLast((segment) => segment.length > 0) ?? path;
}

export function projectPickerLabels<Id extends string>(
  projects: ReadonlyArray<LabeledProject<Id>>,
): ReadonlyMap<Id, string> {
  const titleCounts = new Map<string, number>();
  for (const project of projects) {
    titleCounts.set(project.title, (titleCounts.get(project.title) ?? 0) + 1);
  }
  const folderCounts = new Map<string, number>();
  for (const project of projects) {
    if (titleCounts.get(project.title) === 1) continue;
    const key = `${project.title}\0${lastPathSegment(project.workspaceRoot)}`;
    folderCounts.set(key, (folderCounts.get(key) ?? 0) + 1);
  }
  return new Map(
    projects.map((project) => {
      if (titleCounts.get(project.title) === 1) return [project.id, project.title];
      const folder = lastPathSegment(project.workspaceRoot);
      const hint =
        folderCounts.get(`${project.title}\0${folder}`) === 1 ? folder : project.workspaceRoot;
      return [project.id, `${project.title} (${hint})`];
    }),
  );
}
