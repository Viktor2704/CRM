export const canUseInternalGlobalExport = (
    actorRole: string | null | undefined,
    internalGlobalRoles: ReadonlySet<string>,
) => internalGlobalRoles.has(actorRole ?? '');
