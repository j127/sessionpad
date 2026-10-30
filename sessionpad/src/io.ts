// What the mod's code reaches outside itself. hooks/register.ts builds it
// from a hook's $ (see ioOf there), writing out every call on $ the mod
// makes: the plugin directory lists a mod's calls from its hooks module
// alone, and refuses $ handed to a function in another file. So no module
// here holds $ itself; each takes this instead, and it does what $ would.
//
// Each member is the engine's own method under the same noun and name, cut
// down to the arguments the mod passes, except `env` and `run`, which name
// the one variable or program each reads or runs.

import type { EngineInterface, StateDollar } from "claude-code";

type Engine = EngineInterface;
type RunInit = NonNullable<Parameters<Engine["process"]["run"]>[1]>;
type Ran = ReturnType<Engine["process"]["run"]>;
type LogOptions = NonNullable<Parameters<Engine["ui"]["log"]>[1]>;

export type Io = StateDollar & {
  store: Pick<Engine["store"], "get" | "set" | "delete" | "keys">;
  clock: Pick<Engine["clock"], "now" | "after" | "every">;
  fs: {
    read: (path: string) => Promise<string>;
    write: Engine["fs"]["write"];
    list: (path: string) => ReturnType<Engine["fs"]["list"]>;
    exists: Engine["fs"]["exists"];
    stat: Engine["fs"]["stat"];
  };
  session: Pick<Engine["session"], "id" | "cwd" | "repo">;
  ui: Pick<Engine["ui"], "resolve" | "invalidate" | "open"> & {
    log: (text: string, options: LogOptions) => void;
    toast: (text: string) => void;
  };
  model: {
    complete: (
      request: Parameters<Engine["model"]["complete"]>[0]
    ) => ReturnType<Engine["model"]["complete"]>;
  };
  env: {
    /** `HOME`, or undefined where it isn't set. */
    home: () => Promise<string | undefined>;
    /** `USERPROFILE`, Windows' home folder. */
    userProfile: () => Promise<string | undefined>;
    /** `CLAUDE_CONFIG_DIR`, set when Claude Code keeps its files elsewhere. */
    configDir: () => Promise<string | undefined>;
  };
  run: {
    /** `git <args>`. */
    git: (args: readonly string[], init: RunInit) => Ran;
    /** `du -sk -- <path>`: one tree's size in kibibytes. */
    du: (path: string, init: RunInit) => Ran;
    /** `rm -f -- <paths>`: the mod's own timeline files, when pruned. */
    rm: (paths: readonly string[], init: RunInit) => Ran;
  };
};
