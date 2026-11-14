{
  description = "T3 Code development shell";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      packages = forAllSystems (pkgs: {
        git-loom = pkgs.callPackage ./nix/git-loom.nix { };
      });

      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = [
            pkgs.nodejs_26
            pkgs.pnpm_12
            pkgs.git
            self.packages.${pkgs.stdenv.hostPlatform.system}.git-loom
          ];
          # pnpm would otherwise switch itself to the packageManager release it downloads,
          # a generic Linux binary that NixOS cannot run.
          env.npm_config_pm_on_fail = "ignore";
          env.npm_config_manage_package_manager_versions = "false";
          shellHook = ''
            export PATH="$PWD/node_modules/.bin:$PATH"
          '';
        };
      });
    };
}
