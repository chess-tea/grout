# Grout ✉️ 📬

> WARNING: Right now this doesn't add any additional features over
[chess-tea/global-state](). Instead of using `Grout` you can use
`global-state` directly.

Routing for Revery

# Documentation

We don't have docs yet. Hah, take that person exploring this library.

# Development

## Primary commands

- `esy` - Builds and installs
- `esy format` - Runs refmt on all source code
- `esy test` - Runs Rely tests
- `esy run` - Runs the example

## Directory setup

- `src/grout`
- `tests/TestExe.re`
  - This is the test executable. Any reason files in `tests` that `open TestFramework` and use `describe` will be registered and run when calling `esy test`.
  - See [reason-native/rely](https://reason-native.com/docs/rely/).
