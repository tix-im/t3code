import { definePluginMigrationTracks } from "../src/plugins/migrations.ts";
import { migrationTrack as tixim } from "./tixim/migrations.ts";

export const pluginMigrationTracks = definePluginMigrationTracks(tixim);
