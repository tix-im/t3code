{
  lib,
  rustPlatform,
  fetchFromGitHub,
  pkg-config,
  git,
  libgit2,
  openssl,
  zlib,
}:

rustPlatform.buildRustPackage rec {
  pname = "git-loom";
  version = "1.0.0";

  src = fetchFromGitHub {
    owner = "narnaud";
    repo = "git-loom";
    tag = "v${version}";
    hash = "sha256-mlfXF8zGPEncpxdOBo87lvJdAYcOJZaC/bIEE6PvmWs=";
  };

  cargoHash = "sha256-lePI2tcrQfLl3k8BUjXlnY657wEhnagxX/euAnB/7Dc=";

  nativeBuildInputs = [ pkg-config ];
  buildInputs = [
    libgit2
    openssl
    zlib
  ];
  nativeCheckInputs = [ git ];

  env.LIBGIT2_NO_VENDOR = 1;

  # The tests create repositories and commit to them.
  preCheck = ''
    export HOME=$(mktemp -d)
    git config --global user.email nixbld@localhost
    git config --global user.name nixbld
    git config --global init.defaultBranch main
  '';

  meta = {
    description = "Weave feature branches into an integration branch";
    homepage = "https://github.com/narnaud/git-loom";
    license = lib.licenses.mit;
    mainProgram = "git-loom";
  };
}
