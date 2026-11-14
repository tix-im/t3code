// Build-time installation switch shared by every host. Historical schemas and migrations remain registered.
export const enabled: boolean = true;

// Startup switch for server contributions, read from the server's environment.
export const serverSwitchOn = (env: Readonly<Record<string, string | undefined>>) =>
  env.T3CODE_TIXIM !== "0";
