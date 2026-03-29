# Gazelle Migration Plan: Custom Macros to Stock Rules

## Goal

Decompose custom Bazel macros in `tools/index.bzl` and `tools/vitest.bzl` so that `ts_project` targets are visible at the BUILD file level. This lets gazelle manage `deps` by reading TypeScript imports, which is its primary value.

## Current Custom Macros

### `ts_compile(name, srcs, deps)`

**Location:** `tools/index.bzl`

Expands to 3 targets:

1. `ts_project` — typecheck only (`no_emit=True`, `transpiler=tsgo`)
2. `ts_project` — transpile with oxc (`transpiler=oxc_transpiler`, `declaration_transpiler=oxc_transpiler`)
3. `js_library` — bundles transpiled output + `package.json`

**Used by:** Most library packages (e.g., `intl-localematcher`, `ecma402-abstract`, `intl-messageformat`)

### `ts_compile_node(name, srcs, deps)`

**Location:** `tools/index.bzl`

Identical to `ts_compile` but uses `ESNEXT_TSCONFIG` instead of `BASE_TSCONFIG`.

**Used by:** Node tooling packages (e.g., `cli-lib`)

### `vitest(name, srcs, deps, ...)`

**Location:** `tools/vitest.bzl`

Expands to:

1. `ts_project` — typecheck for tests (`no_emit=True`, `transpiler=tsgo`, `ESNEXT_TSCONFIG` + `skipLibCheck`)
2. `vitest_bin.vitest_test` — actual test runner
3. Per-snapshot-dir targets: `vitest_bin.vitest` (update) + `write_source_file` (write back)
4. `write_source_files` — aggregates all snapshot update targets

**Used by:** All packages with tests

### `ts_binary(name, data, node_options, ...)`

**Location:** `tools/index.bzl`

Thin wrapper around `js_binary` that adds `--experimental-transform-types` to `node_options`.

**Used by:** Benchmark runners, codegen scripts, CLI entry points

### `generate_src_file(name, src, entry_point, ...)`

**Location:** `tools/index.bzl`

Codegen pipeline: `ts_run_binary` -> optional `oxfmt` format -> `write_source_files`. All scripts are expected to accept `--out` flag.

**Used by:** CLDR data generation, regex generation, locale data scripts

### `generate_ide_tsconfig_json()`

**Location:** `tools/index.bzl`

Generates a per-package `tsconfig.json` with the correct relative `extends` path to root `tsconfig.json`. Purely for IDE support.

**Used by:** All packages

### `package_json_test()`

**Location:** `tools/index.bzl`

Currently dead code — the actual test logic is commented out. Only does `copy_to_bin` for `package.json`.

## What Gazelle Can and Cannot Manage

### Gazelle CAN manage

- `npm_link_all_packages()` calls
- `ts_project` targets — reads `.ts` imports to generate `srcs` globs + `deps`
- `ts_config` targets

### Gazelle CANNOT manage

- Dual typecheck + transpile pattern (tsgo + oxc)
- `vitest` test runner + snapshot machinery
- `npm_package` / dist packaging
- `esbuild` bundles
- `generate_src_file` codegen
- `generate_ide_tsconfig_json`

## Migration Phases

### Phase 1: Inline thin wrappers (**DONE**)

**Effort:** Low | **Risk:** Low

- ~~Replace `ts_binary` calls with `js_binary` + `--experimental-transform-types` directly in BUILD files~~ Done (9 BUILD files, 22 calls)
- ~~Remove `package_json_test` (dead code — test body is commented out)~~ Done (28 BUILD files)
- `copy_to_bin(name = "package", ...)` was only created inside the macro, nothing external depended on it — removed with the macro call

### Phase 2: Decompose `ts_compile` into stock rules (**DONE**)

**Effort:** Medium | **Risk:** Medium

Replaced all `ts_compile` (21 packages) and `ts_compile_node` (7 packages) calls with explicit inline targets. Each macro expanded to 3 targets: ts_project (typecheck), ts_project (transpile), js_library (bundle).

Example expansion:

```python
# Gazelle manages deps on this target
ts_project(
    name = "dist-typecheck",
    srcs = [":srcs"],
    deps = SRC_DEPS,
    transpiler = tsgo_bin.tsgo,
    tsconfig = BASE_TSCONFIG,
    no_emit = True,
    declaration = True,
)

# Gazelle manages deps on this target
ts_project(
    name = "dist-esm",
    srcs = [":srcs"],
    deps = SRC_DEPS + ["//:node_modules/oxc-transform"],
    transpiler = oxc_transpiler,
    declaration_transpiler = oxc_transpiler,
    tsconfig = BASE_TSCONFIG,
    declaration = True,
)

# Manual — gazelle doesn't touch js_library
js_library(
    name = "dist",
    srcs = [":dist-esm", "package.json"],
    visibility = ["//visibility:public"],
)
```

Do the same for `ts_compile_node` but with `ESNEXT_TSCONFIG`.

**Packages to update:** ~30 library packages under `packages/`

### Phase 3: Decompose `vitest` test macro (**DONE**)

**Effort:** Medium | **Risk:** Medium

Created `vitest_runner` macro in `tools/vitest.bzl` (test runner + snapshots, no type-checking). Inlined `ts_project` typecheck into all 40 vitest call sites across 34 BUILD files. Exported `TEST_TSCONFIG`, `VITEST_DEPS`, `VITEST_DOM_DEPS` from vitest.bzl for use in BUILD files.

Split into:

1. **Inline `ts_project`** for test typechecking (gazelle manages deps):

```python
ts_project(
    name = "unit_test_typecheck",
    srcs = SRCS + TESTS,
    deps = TEST_DEPS + ["//:node_modules/vitest", "//:node_modules/@types/node"],
    transpiler = tsgo_bin.tsgo,
    tsconfig = TEST_TSCONFIG,
    no_emit = True,
    declaration = True,
    testonly = True,
)
```

2. **Slim custom macro** for just the test runner + snapshots (no type-checking):

```python
vitest_runner(
    name = "unit_test",
    srcs = SRCS + TESTS,
    deps = TEST_DEPS,
)
```

This `vitest_runner` macro would contain only the `vitest_bin.vitest_test` call and snapshot update targets — no `ts_project`.

### Phase 4: Enable gazelle with map_kind (**IN PROGRESS**)

Created `tools/formatjs_lib.bzl` with `formatjs_ts_project` macro that wraps the dual typecheck+transpile pattern. Plan:

1. Use `# gazelle:map_kind ts_project formatjs_ts_project //tools:formatjs_lib.bzl` to map gazelle's generated targets to our macro
2. Use `# gazelle:js_project_naming_convention dist` and `# gazelle:js_tests_naming_convention unit_test` to match our existing target names
3. Convert all packages to use `formatjs_ts_project` macro
4. Enable `# gazelle:js enabled` in root BUILD.bazel

**Known issues to resolve:**

- Gazelle replaces `[":srcs"]` (copy_to_bin target) with expanded file lists, which includes test fixtures and scripts that break the transpiler. Fix: either use `# gazelle:js_files` directive to control glob patterns, or update the macro to filter non-source files.
- `ts_project` auto-generates `_typecheck_test` targets (build_test) that use tsc with file-based tsconfig. For packages needing ESNEXT_TSCONFIG, these fail because the file-based tsconfig inherits ES2017 from root. Fix: add `validate = False` to internal ts_project calls, or update package tsconfig.json files.
- Need `# gazelle:js disabled` in dirs with naming conflicts: benchmarks, docs, examples, editor, and complex integration-tests.

### Phase 5: Leave everything else as-is

These are packaging/codegen concerns that gazelle shouldn't touch:

- `npm_package` targets
- `esbuild` bundles
- `generate_src_file` codegen targets
- `generate_ide_tsconfig_json` targets

## TSConfig Strategy

The `tsconfig` values are currently Starlark dicts defined in `tools/tsconfig.bzl` and passed inline to `ts_project`. This works with gazelle — `ts_project(tsconfig = BASE_TSCONFIG)` is valid and gazelle won't touch the `tsconfig` attribute. Alternatively, migrate to `ts_config` targets that gazelle can generate, but this is optional.
