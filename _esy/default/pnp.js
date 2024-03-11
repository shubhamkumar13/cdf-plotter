#!/usr/bin/env node

/* eslint-disable max-len, flowtype/require-valid-file-annotation, flowtype/require-return-type */
/* global packageInformationStores, null, $$SETUP_STATIC_TABLES */

// Used for the resolveUnqualified part of the resolution (ie resolving folder/index.js & file extensions)
// Deconstructed so that they aren't affected by any fs monkeypatching occuring later during the execution
const {statSync, lstatSync, readlinkSync, readFileSync, existsSync, realpathSync} = require('fs');

const Module = require('module');
const path = require('path');
const StringDecoder = require('string_decoder');

const ignorePattern = null ? new RegExp(null) : null;

const pnpFile = path.resolve(__dirname, __filename);
const builtinModules = new Set(Module.builtinModules || Object.keys(process.binding('natives')));

const topLevelLocator = {name: null, reference: null};
const blacklistedLocator = {name: NaN, reference: NaN};

// Used for compatibility purposes - cf setupCompatibilityLayer
const patchedModules = [];
const fallbackLocators = [topLevelLocator];

// Matches backslashes of Windows paths
const backwardSlashRegExp = /\\/g;

// Matches if the path must point to a directory (ie ends with /)
const isDirRegExp = /\/$/;

// Matches if the path starts with a valid path qualifier (./, ../, /)
// eslint-disable-next-line no-unused-vars
const isStrictRegExp = /^\.{0,2}\//;

// Splits a require request into its components, or return null if the request is a file path
const pathRegExp = /^(?![a-zA-Z]:[\\\/]|\\\\|\.{0,2}(?:\/|$))((?:@[^\/]+\/)?[^\/]+)\/?(.*|)$/;

// Keep a reference around ("module" is a common name in this context, so better rename it to something more significant)
const pnpModule = module;

/**
 * Used to disable the resolution hooks (for when we want to fallback to the previous resolution - we then need
 * a way to "reset" the environment temporarily)
 */

let enableNativeHooks = true;

/**
 * Simple helper function that assign an error code to an error, so that it can more easily be caught and used
 * by third-parties.
 */

function makeError(code, message, data = {}) {
  const error = new Error(message);
  return Object.assign(error, {code, data});
}

/**
 * Ensures that the returned locator isn't a blacklisted one.
 *
 * Blacklisted packages are packages that cannot be used because their dependencies cannot be deduced. This only
 * happens with peer dependencies, which effectively have different sets of dependencies depending on their parents.
 *
 * In order to deambiguate those different sets of dependencies, the Yarn implementation of PnP will generate a
 * symlink for each combination of <package name>/<package version>/<dependent package> it will find, and will
 * blacklist the target of those symlinks. By doing this, we ensure that files loaded through a specific path
 * will always have the same set of dependencies, provided the symlinks are correctly preserved.
 *
 * Unfortunately, some tools do not preserve them, and when it happens PnP isn't able anymore to deduce the set of
 * dependencies based on the path of the file that makes the require calls. But since we've blacklisted those paths,
 * we're able to print a more helpful error message that points out that a third-party package is doing something
 * incompatible!
 */

// eslint-disable-next-line no-unused-vars
function blacklistCheck(locator) {
  if (locator === blacklistedLocator) {
    throw makeError(
      `BLACKLISTED`,
      [
        `A package has been resolved through a blacklisted path - this is usually caused by one of your tools calling`,
        `"realpath" on the return value of "require.resolve". Since the returned values use symlinks to disambiguate`,
        `peer dependencies, they must be passed untransformed to "require".`,
      ].join(` `)
    );
  }

  return locator;
}

let packageInformationStores = new Map([
["@esy-ocaml/substs",
new Map([["0.0.1",
         {
           packageLocation: "/home/sk/.esy/source/i/esy_ocaml__s__substs__0.0.1__19de1ee1/",
           packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"]])}]])],
  ["@opam/angstrom",
  new Map([["opam:0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__angstrom__opam__c__0.16.0__d7090c1e/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/angstrom",
                                             "opam:0.16.0"],
                                             ["@opam/bigstringaf",
                                             "opam:0.9.1"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/ocaml-syntax-shims",
                                             "opam:1.0.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/astring",
  new Map([["opam:0.8.5",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__astring__opam__c__0.8.5__471b9e4a/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/astring", "opam:0.8.5"],
                                             ["@opam/ocamlbuild",
                                             "opam:0.14.3"],
                                             ["@opam/ocamlfind",
                                             "opam:1.9.6"],
                                             ["@opam/topkg", "opam:1.0.7"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/async",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__async__opam__c__v0.16.0__5d6e5d97/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/async", "opam:v0.16.0"],
                                             ["@opam/async_kernel",
                                             "opam:v0.16.0"],
                                             ["@opam/async_rpc_kernel",
                                             "opam:v0.16.0"],
                                             ["@opam/async_unix",
                                             "opam:v0.16.0"],
                                             ["@opam/core", "opam:v0.16.2"],
                                             ["@opam/core_kernel",
                                             "opam:v0.16.0"],
                                             ["@opam/core_unix",
                                             "opam:v0.16.0"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/ppx_jane",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_log",
                                             "opam:v0.16.0"],
                                             ["@opam/textutils",
                                             "opam:v0.16.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/async_kernel",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__async__kernel__opam__c__v0.16.0__cbe62377/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/async_kernel",
                                             "opam:v0.16.0"],
                                             ["@opam/core", "opam:v0.16.2"],
                                             ["@opam/core_kernel",
                                             "opam:v0.16.0"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/ppx_jane",
                                             "opam:v0.16.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/async_rpc_kernel",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__async__rpc__kernel__opam__c__v0.16.0__99ba00b0/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/async_kernel",
                                             "opam:v0.16.0"],
                                             ["@opam/async_rpc_kernel",
                                             "opam:v0.16.0"],
                                             ["@opam/core", "opam:v0.16.2"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/ppx_jane",
                                             "opam:v0.16.0"],
                                             ["@opam/protocol_version_header",
                                             "opam:v0.16.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/async_unix",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__async__unix__opam__c__v0.16.0__8e3b2d0e/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/async_kernel",
                                             "opam:v0.16.0"],
                                             ["@opam/async_unix",
                                             "opam:v0.16.0"],
                                             ["@opam/core", "opam:v0.16.2"],
                                             ["@opam/core_kernel",
                                             "opam:v0.16.0"],
                                             ["@opam/core_unix",
                                             "opam:v0.16.0"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/ppx_jane",
                                             "opam:v0.16.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/base",
  new Map([["opam:v0.16.3",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__base__opam__c__v0.16.3__eb58c630/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.16.3"],
                                             ["@opam/conf-bash", "opam:1"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/dune-configurator",
                                             "opam:3.14.0"],
                                             ["@opam/sexplib0",
                                             "opam:v0.16.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/base-bytes",
  new Map([["opam:base",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__base_bytes__opam__c__base__48b6019a/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base-bytes",
                                             "opam:base"],
                                             ["@opam/ocamlfind",
                                             "opam:1.9.6"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/base-threads",
  new Map([["opam:base",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__base_threads__opam__c__base__f282958b/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base-threads",
                                             "opam:base"]])}]])],
  ["@opam/base-unix",
  new Map([["opam:base",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__base_unix__opam__c__base__93427a57/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base-unix", "opam:base"]])}]])],
  ["@opam/base_bigstring",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__base__bigstring__opam__c__v0.16.0__a521851b/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.16.3"],
                                             ["@opam/base_bigstring",
                                             "opam:v0.16.0"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/int_repr",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_jane",
                                             "opam:v0.16.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/base_quickcheck",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__base__quickcheck__opam__c__v0.16.0__f39878e5/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.16.3"],
                                             ["@opam/base_quickcheck",
                                             "opam:v0.16.0"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/ppx_base",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_fields_conv",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_let",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_sexp_message",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_sexp_value",
                                             "opam:v0.16.0"],
                                             ["@opam/ppxlib",
                                             "opam:0.32.1~5.2preview"],
                                             ["@opam/splittable_random",
                                             "opam:v0.16.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/bigarray-compat",
  new Map([["opam:1.1.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__bigarray_compat__opam__c__1.1.0__ec432e34/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/bigarray-compat",
                                             "opam:1.1.0"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/bigstringaf",
  new Map([["opam:0.9.1",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__bigstringaf__opam__c__0.9.1__94edc918/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/bigstringaf",
                                             "opam:0.9.1"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/dune-configurator",
                                             "opam:3.14.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/bin_prot",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__bin__prot__opam__c__v0.16.0__4f3cd1db/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.16.3"],
                                             ["@opam/bin_prot",
                                             "opam:v0.16.0"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/ppx_compare",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_custom_printf",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_fields_conv",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_optcomp",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_sexp_conv",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_stable_witness",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_variants_conv",
                                             "opam:v0.16.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/camlp-streams",
  new Map([["opam:5.0.1",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__camlp_streams__opam__c__5.0.1__35498539/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/camlp-streams",
                                             "opam:5.0.1"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/chrome-trace",
  new Map([["opam:3.14.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__chrome_trace__opam__c__3.14.0__6be1334a/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/chrome-trace",
                                             "opam:3.14.0"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/cmdliner",
  new Map([["opam:1.2.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__cmdliner__opam__c__1.2.0__9a2a11b5/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/cmdliner", "opam:1.2.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/colors",
  new Map([["opam:0.0.1",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__colors__opam__c__0.0.1__55e3b4eb/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/colors", "opam:0.0.1"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/conf-bash",
  new Map([["opam:1",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__conf_bash__opam__c__1__6a489164/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/conf-bash", "opam:1"]])}]])],
  ["@opam/conf-cmake",
  new Map([["opam:1",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__conf_cmake__opam__c__1__82f13c88/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/conf-cmake", "opam:1"]])}]])],
  ["@opam/conf-libffi",
  new Map([["opam:2.0.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__conf_libffi__opam__c__2.0.0__16382ec8/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/conf-libffi",
                                             "opam:2.0.0"],
                                             ["@opam/conf-pkg-config",
                                             "opam:2"],
                                             ["esy-libffi", "3.3.1"]])}]])],
  ["@opam/conf-pkg-config",
  new Map([["opam:2",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__conf_pkg_config__opam__c__2__a15208ab/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/conf-pkg-config",
                                             "opam:2"],
                                             ["yarn-pkg-config",
                                             "github:esy-ocaml/yarn-pkg-config#db3a0b63883606dd57c54a7158d560d6cba8cd79"]])}]])],
  ["@opam/conf-texinfo",
  new Map([["github:esy-packages/esy-texinfo:package.json#4a05feafbbcc4c57d5d25899fbdab98961b9a69c",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__conf_texinfo__358d35e6/",
             packageDependencies: new Map([["@opam/conf-texinfo",
                                           "github:esy-packages/esy-texinfo:package.json#4a05feafbbcc4c57d5d25899fbdab98961b9a69c"]])}]])],
  ["@opam/conf-zlib",
  new Map([["opam:1",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__conf_zlib__opam__c__1__80da1441/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/conf-pkg-config",
                                             "opam:2"],
                                             ["@opam/conf-zlib", "opam:1"],
                                             ["esy-zlib",
                                             "github:esy-packages/esy-zlib#404929fd8b7ed83ed6a528d751840faff957b4b3"]])}]])],
  ["@opam/core",
  new Map([["opam:v0.16.2",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__core__opam__c__v0.16.2__8fbbe674/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.16.3"],
                                             ["@opam/base_bigstring",
                                             "opam:v0.16.0"],
                                             ["@opam/base_quickcheck",
                                             "opam:v0.16.0"],
                                             ["@opam/bin_prot",
                                             "opam:v0.16.0"],
                                             ["@opam/core", "opam:v0.16.2"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/fieldslib",
                                             "opam:v0.16.0"],
                                             ["@opam/jane-street-headers",
                                             "opam:v0.16.0"],
                                             ["@opam/jst-config",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_assert",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_base",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_hash",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_inline_test",
                                             "opam:v0.16.1"],
                                             ["@opam/ppx_jane",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_optcomp",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_sexp_conv",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_sexp_message",
                                             "opam:v0.16.0"],
                                             ["@opam/sexplib",
                                             "opam:v0.16.0"],
                                             ["@opam/splittable_random",
                                             "opam:v0.16.0"],
                                             ["@opam/stdio", "opam:v0.16.0"],
                                             ["@opam/time_now",
                                             "opam:v0.16.0"],
                                             ["@opam/typerep",
                                             "opam:v0.16.0"],
                                             ["@opam/variantslib",
                                             "opam:v0.16.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/core_kernel",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__core__kernel__opam__c__v0.16.0__073f3c34/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.16.3"],
                                             ["@opam/base-threads",
                                             "opam:base"],
                                             ["@opam/core", "opam:v0.16.2"],
                                             ["@opam/core_kernel",
                                             "opam:v0.16.0"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/int_repr",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_jane",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_optcomp",
                                             "opam:v0.16.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/core_unix",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__core__unix__opam__c__v0.16.0__318b914f/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base-threads",
                                             "opam:base"],
                                             ["@opam/core", "opam:v0.16.2"],
                                             ["@opam/core_kernel",
                                             "opam:v0.16.0"],
                                             ["@opam/core_unix",
                                             "opam:v0.16.0"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/expect_test_helpers_core",
                                             "opam:v0.16.0"],
                                             ["@opam/jane-street-headers",
                                             "opam:v0.16.0"],
                                             ["@opam/jst-config",
                                             "opam:v0.16.0"],
                                             ["@opam/ocaml_intrinsics",
                                             "opam:v0.16.1"],
                                             ["@opam/ppx_jane",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_optcomp",
                                             "opam:v0.16.0"],
                                             ["@opam/sexplib",
                                             "opam:v0.16.0"],
                                             ["@opam/spawn", "opam:v0.15.1"],
                                             ["@opam/timezone",
                                             "opam:v0.16.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/cppo",
  new Map([["opam:1.6.9",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__cppo__opam__c__1.6.9__327e8fcf/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base-unix", "opam:base"],
                                             ["@opam/cppo", "opam:1.6.9"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/csexp",
  new Map([["opam:1.5.2",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__csexp__opam__c__1.5.2__d986413e/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/csexp", "opam:1.5.2"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/cstruct",
  new Map([["opam:6.2.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__cstruct__opam__c__6.2.0__cdef52c2/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/cstruct", "opam:6.2.0"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/fmt", "opam:0.9.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/ctypes",
  new Map([["opam:0.22.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__ctypes__opam__c__0.22.0__72ae3932/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/bigarray-compat",
                                             "opam:1.1.0"],
                                             ["@opam/ctypes", "opam:0.22.0"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/dune-configurator",
                                             "opam:3.14.0"],
                                             ["@opam/integers", "opam:0.7.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/ctypes-foreign",
  new Map([["opam:0.22.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__ctypes_foreign__opam__c__0.22.0__e3aa7450/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/conf-libffi",
                                             "opam:2.0.0"],
                                             ["@opam/conf-pkg-config",
                                             "opam:2"],
                                             ["@opam/ctypes", "opam:0.22.0"],
                                             ["@opam/ctypes-foreign",
                                             "opam:0.22.0"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/dune-configurator",
                                             "opam:3.14.0"],
                                             ["esy-libffi", "3.3.1"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/domain-local-await",
  new Map([["opam:1.0.1",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__domain_local_await__opam__c__1.0.1__ba2e773a/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/domain-local-await",
                                             "opam:1.0.1"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/thread-table",
                                             "opam:1.0.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/dot-merlin-reader",
  new Map([["opam:4.9",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__dot_merlin_reader__opam__c__4.9__eb22f8e0/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dot-merlin-reader",
                                             "opam:4.9"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/merlin-lib",
                                             "opam:4.13-501"],
                                             ["@opam/ocamlfind",
                                             "opam:1.9.6"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/dune",
  new Map([["opam:3.14.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__dune__opam__c__3.14.0__79f978ef/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base-threads",
                                             "opam:base"],
                                             ["@opam/base-unix", "opam:base"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/dune-build-info",
  new Map([["opam:3.14.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__dune_build_info__opam__c__3.14.0__824091b1/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/dune-build-info",
                                             "opam:3.14.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/dune-configurator",
  new Map([["opam:3.14.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__dune_configurator__opam__c__3.14.0__bdbedf02/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base-unix", "opam:base"],
                                             ["@opam/csexp", "opam:1.5.2"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/dune-configurator",
                                             "opam:3.14.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/dune-rpc",
  new Map([["opam:3.14.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__dune_rpc__opam__c__3.14.0__d565b221/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/csexp", "opam:1.5.2"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/dune-rpc",
                                             "opam:3.14.0"],
                                             ["@opam/dyn", "opam:3.14.0"],
                                             ["@opam/ordering",
                                             "opam:3.14.0"],
                                             ["@opam/pp", "opam:1.2.0"],
                                             ["@opam/stdune", "opam:3.14.0"],
                                             ["@opam/xdg", "opam:3.14.0"]])}]])],
  ["@opam/dyn",
  new Map([["opam:3.14.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__dyn__opam__c__3.14.0__8f471f60/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/dyn", "opam:3.14.0"],
                                             ["@opam/ordering",
                                             "opam:3.14.0"],
                                             ["@opam/pp", "opam:1.2.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/eio",
  new Map([["opam:0.15",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__eio__opam__c__0.15__6732392c/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/bigstringaf",
                                             "opam:0.9.1"],
                                             ["@opam/cstruct", "opam:6.2.0"],
                                             ["@opam/domain-local-await",
                                             "opam:1.0.1"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/eio", "opam:0.15"],
                                             ["@opam/fmt", "opam:0.9.0"],
                                             ["@opam/hmap", "opam:0.8.1"],
                                             ["@opam/lwt-dllist",
                                             "opam:1.0.1"],
                                             ["@opam/mtime", "opam:2.0.0"],
                                             ["@opam/optint", "opam:0.3.0"],
                                             ["@opam/psq", "opam:0.2.1"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/eio_linux",
  new Map([["opam:0.15",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__eio__linux__opam__c__0.15__361ca0df/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/eio", "opam:0.15"],
                                             ["@opam/eio_linux", "opam:0.15"],
                                             ["@opam/fmt", "opam:0.9.0"],
                                             ["@opam/logs", "opam:0.7.0"],
                                             ["@opam/uring", "opam:0.8"]])}]])],
  ["@opam/eio_main",
  new Map([["opam:0.15",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__eio__main__opam__c__0.15__6a0c6284/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/eio_linux", "opam:0.15"],
                                             ["@opam/eio_main", "opam:0.15"],
                                             ["@opam/eio_posix", "opam:0.15"],
                                             ["@opam/eio_windows",
                                             "opam:0.15"]])}]])],
  ["@opam/eio_posix",
  new Map([["opam:0.15",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__eio__posix__opam__c__0.15__d55f4b42/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/eio", "opam:0.15"],
                                             ["@opam/eio_posix", "opam:0.15"],
                                             ["@opam/fmt", "opam:0.9.0"],
                                             ["@opam/iomux", "opam:0.3"]])}]])],
  ["@opam/eio_windows",
  new Map([["opam:0.15",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__eio__windows__opam__c__0.15__368bbf8a/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/eio", "opam:0.15"],
                                             ["@opam/eio_windows",
                                             "opam:0.15"],
                                             ["@opam/fmt", "opam:0.9.0"]])}]])],
  ["@opam/either",
  new Map([["opam:1.0.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__either__opam__c__1.0.0__29ca51fc/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/either", "opam:1.0.0"]])}]])],
  ["@opam/expect_test_helpers_core",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__expect__test__helpers__core__opam__c__v0.16.0__3360ec87/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.16.3"],
                                             ["@opam/base_quickcheck",
                                             "opam:v0.16.0"],
                                             ["@opam/core", "opam:v0.16.2"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/expect_test_helpers_core",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_jane",
                                             "opam:v0.16.0"],
                                             ["@opam/re", "opam:1.11.0"],
                                             ["@opam/sexp_pretty",
                                             "opam:v0.16.0"],
                                             ["@opam/stdio", "opam:v0.16.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/fiber",
  new Map([["opam:3.7.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__fiber__opam__c__3.7.0__283d7f54/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/dyn", "opam:3.14.0"],
                                             ["@opam/fiber", "opam:3.7.0"],
                                             ["@opam/stdune", "opam:3.14.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/fieldslib",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__fieldslib__opam__c__v0.16.0__9ca901db/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.16.3"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/fieldslib",
                                             "opam:v0.16.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/fix",
  new Map([["opam:20230505",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__fix__opam__c__20230505__c9f697a2/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/fix", "opam:20230505"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/fmt",
  new Map([["opam:0.9.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__fmt__opam__c__0.9.0__2f7f274d/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base-unix", "opam:base"],
                                             ["@opam/cmdliner", "opam:1.2.0"],
                                             ["@opam/fmt", "opam:0.9.0"],
                                             ["@opam/ocamlbuild",
                                             "opam:0.14.3"],
                                             ["@opam/ocamlfind",
                                             "opam:1.9.6"],
                                             ["@opam/topkg", "opam:1.0.7"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/fpath",
  new Map([["opam:0.7.3",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__fpath__opam__c__0.7.3__18652e33/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/astring", "opam:0.8.5"],
                                             ["@opam/fpath", "opam:0.7.3"],
                                             ["@opam/ocamlbuild",
                                             "opam:0.14.3"],
                                             ["@opam/ocamlfind",
                                             "opam:1.9.6"],
                                             ["@opam/topkg", "opam:1.0.7"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/hdr_histogram",
  new Map([["opam:0.0.3",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__hdr__histogram__opam__c__0.0.3__f683092c/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/conf-cmake", "opam:1"],
                                             ["@opam/conf-pkg-config",
                                             "opam:2"],
                                             ["@opam/conf-zlib", "opam:1"],
                                             ["@opam/ctypes", "opam:0.22.0"],
                                             ["@opam/ctypes-foreign",
                                             "opam:0.22.0"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/hdr_histogram",
                                             "opam:0.0.3"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/hmap",
  new Map([["opam:0.8.1",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__hmap__opam__c__0.8.1__f8cac8ba/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/hmap", "opam:0.8.1"],
                                             ["@opam/ocamlbuild",
                                             "opam:0.14.3"],
                                             ["@opam/ocamlfind",
                                             "opam:1.9.6"],
                                             ["@opam/topkg", "opam:1.0.7"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/int_repr",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__int__repr__opam__c__v0.16.0__fe4e971e/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.16.3"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/int_repr",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_jane",
                                             "opam:v0.16.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/integers",
  new Map([["opam:0.7.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__integers__opam__c__0.7.0__10894044/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/integers", "opam:0.7.0"],
                                             ["@opam/stdlib-shims",
                                             "opam:0.3.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/iomux",
  new Map([["opam:0.3",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__iomux__opam__c__0.3__263e94a1/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/dune-configurator",
                                             "opam:3.14.0"],
                                             ["@opam/iomux", "opam:0.3"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/jane-street-headers",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__jane_street_headers__opam__c__v0.16.0__577c46ab/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/jane-street-headers",
                                             "opam:v0.16.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/jst-config",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__jst_config__opam__c__v0.16.0__cf378de6/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.16.3"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/dune-configurator",
                                             "opam:3.14.0"],
                                             ["@opam/jst-config",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_assert",
                                             "opam:v0.16.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/leaves",
  new Map([["opam:0.0.2",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__leaves__opam__c__0.0.2__ec395a6b/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/leaves", "opam:0.0.2"],
                                             ["@opam/minttea", "opam:0.0.2"],
                                             ["@opam/spices", "opam:0.0.2"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/logs",
  new Map([["opam:0.7.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__logs__opam__c__0.7.0__da3c2fe0/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base-threads",
                                             "opam:base"],
                                             ["@opam/cmdliner", "opam:1.2.0"],
                                             ["@opam/fmt", "opam:0.9.0"],
                                             ["@opam/logs", "opam:0.7.0"],
                                             ["@opam/ocamlbuild",
                                             "opam:0.14.3"],
                                             ["@opam/ocamlfind",
                                             "opam:1.9.6"],
                                             ["@opam/topkg", "opam:1.0.7"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/lwt-dllist",
  new Map([["opam:1.0.1",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__lwt_dllist__opam__c__1.0.1__19ad5258/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/lwt-dllist",
                                             "opam:1.0.1"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/menhir",
  new Map([["opam:20231231",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__menhir__opam__c__20231231__e3fcfc8d/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/menhir",
                                             "opam:20231231"],
                                             ["@opam/menhirCST",
                                             "opam:20231231"],
                                             ["@opam/menhirLib",
                                             "opam:20231231"],
                                             ["@opam/menhirSdk",
                                             "opam:20231231"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/menhirCST",
  new Map([["opam:20231231",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__menhircst__opam__c__20231231__dd9c625c/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/menhirCST",
                                             "opam:20231231"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/menhirLib",
  new Map([["opam:20231231",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__menhirlib__opam__c__20231231__c74d66e3/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/menhirLib",
                                             "opam:20231231"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/menhirSdk",
  new Map([["opam:20231231",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__menhirsdk__opam__c__20231231__9e75caf2/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/menhirSdk",
                                             "opam:20231231"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/merlin-lib",
  new Map([["opam:4.13-501",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__merlin_lib__opam__c__4.13_501__1099d3d4/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/csexp", "opam:1.5.2"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/merlin-lib",
                                             "opam:4.13-501"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/minttea",
  new Map([["opam:0.0.2",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__minttea__opam__c__0.0.2__20156ee4/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/minttea", "opam:0.0.2"],
                                             ["@opam/riot", "opam:0.0.5"],
                                             ["@opam/tty", "opam:0.0.2"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/mtime",
  new Map([["opam:2.0.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__mtime__opam__c__2.0.0__012608b8/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/mtime", "opam:2.0.0"],
                                             ["@opam/ocamlbuild",
                                             "opam:0.14.3"],
                                             ["@opam/ocamlfind",
                                             "opam:1.9.6"],
                                             ["@opam/topkg", "opam:1.0.7"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/num",
  new Map([["opam:1.5",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__num__opam__c__1.5__494b8cb1/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/num", "opam:1.5"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/ocaml-compiler-libs",
  new Map([["opam:v0.12.4",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__ocaml_compiler_libs__opam__c__v0.12.4__3bec24dd/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/ocaml-compiler-libs",
                                             "opam:v0.12.4"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/ocaml-lsp-server",
  new Map([["opam:1.17.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__ocaml_lsp_server__opam__c__1.17.0__d7ff5a04/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/astring", "opam:0.8.5"],
                                             ["@opam/camlp-streams",
                                             "opam:5.0.1"],
                                             ["@opam/chrome-trace",
                                             "opam:3.14.0"],
                                             ["@opam/csexp", "opam:1.5.2"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/dune-build-info",
                                             "opam:3.14.0"],
                                             ["@opam/dune-rpc",
                                             "opam:3.14.0"],
                                             ["@opam/dyn", "opam:3.14.0"],
                                             ["@opam/fiber", "opam:3.7.0"],
                                             ["@opam/merlin-lib",
                                             "opam:4.13-501"],
                                             ["@opam/ocaml-lsp-server",
                                             "opam:1.17.0"],
                                             ["@opam/ocamlc-loc",
                                             "opam:3.14.0"],
                                             ["@opam/ocamlformat-rpc-lib",
                                             "opam:0.26.1"],
                                             ["@opam/ordering",
                                             "opam:3.14.0"],
                                             ["@opam/pp", "opam:1.2.0"],
                                             ["@opam/ppx_yojson_conv_lib",
                                             "opam:v0.16.0"],
                                             ["@opam/re", "opam:1.11.0"],
                                             ["@opam/spawn", "opam:v0.15.1"],
                                             ["@opam/stdune", "opam:3.14.0"],
                                             ["@opam/uutf", "opam:1.0.3"],
                                             ["@opam/xdg", "opam:3.14.0"],
                                             ["@opam/yojson", "opam:2.1.2"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/ocaml-syntax-shims",
  new Map([["opam:1.0.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__ocaml_syntax_shims__opam__c__1.0.0__cb8d5a09/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/ocaml-syntax-shims",
                                             "opam:1.0.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/ocaml-version",
  new Map([["opam:3.6.4",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__ocaml_version__opam__c__3.6.4__f15fa505/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/ocaml-version",
                                             "opam:3.6.4"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/ocaml_intrinsics",
  new Map([["opam:v0.16.1",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__ocaml__intrinsics__opam__c__v0.16.1__cb31a101/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/dune-configurator",
                                             "opam:3.14.0"],
                                             ["@opam/ocaml_intrinsics",
                                             "opam:v0.16.1"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/ocamlbuild",
  new Map([["opam:0.14.3",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__ocamlbuild__opam__c__0.14.3__32886626/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/ocamlbuild",
                                             "opam:0.14.3"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/ocamlc-loc",
  new Map([["opam:3.14.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__ocamlc_loc__opam__c__3.14.0__5fc381be/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/dyn", "opam:3.14.0"],
                                             ["@opam/ocamlc-loc",
                                             "opam:3.14.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/ocamlfind",
  new Map([["opam:1.9.6",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__ocamlfind__opam__c__1.9.6__84cbadfb/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/ocamlfind",
                                             "opam:1.9.6"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/ocamlformat",
  new Map([["opam:0.26.1",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__ocamlformat__opam__c__0.26.1__595e9d3a/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/cmdliner", "opam:1.2.0"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/ocamlformat",
                                             "opam:0.26.1"],
                                             ["@opam/ocamlformat-lib",
                                             "opam:0.26.1"],
                                             ["@opam/re", "opam:1.11.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/ocamlformat-lib",
  new Map([["opam:0.26.1",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__ocamlformat_lib__opam__c__0.26.1__3b3acef7/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/astring", "opam:0.8.5"],
                                             ["@opam/base", "opam:v0.16.3"],
                                             ["@opam/camlp-streams",
                                             "opam:5.0.1"],
                                             ["@opam/csexp", "opam:1.5.2"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/dune-build-info",
                                             "opam:3.14.0"],
                                             ["@opam/either", "opam:1.0.0"],
                                             ["@opam/fix", "opam:20230505"],
                                             ["@opam/fpath", "opam:0.7.3"],
                                             ["@opam/menhir",
                                             "opam:20231231"],
                                             ["@opam/menhirLib",
                                             "opam:20231231"],
                                             ["@opam/menhirSdk",
                                             "opam:20231231"],
                                             ["@opam/ocaml-version",
                                             "opam:3.6.4"],
                                             ["@opam/ocamlformat-lib",
                                             "opam:0.26.1"],
                                             ["@opam/ocp-indent",
                                             "opam:1.8.1"],
                                             ["@opam/result", "opam:1.5"],
                                             ["@opam/stdio", "opam:v0.16.0"],
                                             ["@opam/uuseg", "opam:15.1.0"],
                                             ["@opam/uutf", "opam:1.0.3"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/ocamlformat-rpc-lib",
  new Map([["opam:0.26.1",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__ocamlformat_rpc_lib__opam__c__0.26.1__a36a26dd/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/csexp", "opam:1.5.2"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/ocamlformat-rpc-lib",
                                             "opam:0.26.1"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/ocp-indent",
  new Map([["opam:1.8.1",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__ocp_indent__opam__c__1.8.1__2297d668/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base-bytes",
                                             "opam:base"],
                                             ["@opam/cmdliner", "opam:1.2.0"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/ocamlfind",
                                             "opam:1.9.6"],
                                             ["@opam/ocp-indent",
                                             "opam:1.8.1"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/optint",
  new Map([["opam:0.3.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__optint__opam__c__0.3.0__8f8a701d/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/optint", "opam:0.3.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/ordering",
  new Map([["opam:3.14.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__ordering__opam__c__3.14.0__4a5b1f49/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/ordering",
                                             "opam:3.14.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/parsexp",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__parsexp__opam__c__v0.16.0__e936b5ec/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/parsexp",
                                             "opam:v0.16.0"],
                                             ["@opam/sexplib0",
                                             "opam:v0.16.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/pp",
  new Map([["opam:1.2.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__pp__opam__c__1.2.0__d0b5cd43/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/pp", "opam:1.2.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/ppx_assert",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__ppx__assert__opam__c__v0.16.0__b2c7938a/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.16.3"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/ppx_assert",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_cold",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_compare",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_here",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_sexp_conv",
                                             "opam:v0.16.0"],
                                             ["@opam/ppxlib",
                                             "opam:0.32.1~5.2preview"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/ppx_base",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__ppx__base__opam__c__v0.16.0__53eafdee/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/ppx_base",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_cold",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_compare",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_enumerate",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_globalize",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_hash",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_sexp_conv",
                                             "opam:v0.16.0"],
                                             ["@opam/ppxlib",
                                             "opam:0.32.1~5.2preview"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/ppx_bench",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__ppx__bench__opam__c__v0.16.0__6cbeaa74/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/ppx_bench",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_inline_test",
                                             "opam:v0.16.1"],
                                             ["@opam/ppxlib",
                                             "opam:0.32.1~5.2preview"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/ppx_bin_prot",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__ppx__bin__prot__opam__c__v0.16.0__b6af2fa8/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.16.3"],
                                             ["@opam/bin_prot",
                                             "opam:v0.16.0"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/ppx_bin_prot",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_here",
                                             "opam:v0.16.0"],
                                             ["@opam/ppxlib",
                                             "opam:0.32.1~5.2preview"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/ppx_cold",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__ppx__cold__opam__c__v0.16.0__b113545b/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.16.3"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/ppx_cold",
                                             "opam:v0.16.0"],
                                             ["@opam/ppxlib",
                                             "opam:0.32.1~5.2preview"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/ppx_compare",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__ppx__compare__opam__c__v0.16.0__54fc0164/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.16.3"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/ppx_compare",
                                             "opam:v0.16.0"],
                                             ["@opam/ppxlib",
                                             "opam:0.32.1~5.2preview"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/ppx_custom_printf",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__ppx__custom__printf__opam__c__v0.16.0__10b69edc/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.16.3"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/ppx_custom_printf",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_sexp_conv",
                                             "opam:v0.16.0"],
                                             ["@opam/ppxlib",
                                             "opam:0.32.1~5.2preview"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/ppx_derivers",
  new Map([["opam:1.2.1",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__ppx__derivers__opam__c__1.2.1__136a746e/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/ppx_derivers",
                                             "opam:1.2.1"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/ppx_disable_unused_warnings",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__ppx__disable__unused__warnings__opam__c__v0.16.0__d159d814/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.16.3"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/ppx_disable_unused_warnings",
                                             "opam:v0.16.0"],
                                             ["@opam/ppxlib",
                                             "opam:0.32.1~5.2preview"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/ppx_enumerate",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__ppx__enumerate__opam__c__v0.16.0__dcd077a7/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.16.3"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/ppx_enumerate",
                                             "opam:v0.16.0"],
                                             ["@opam/ppxlib",
                                             "opam:0.32.1~5.2preview"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/ppx_expect",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__ppx__expect__opam__c__v0.16.0__8aa11f3c/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.16.3"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/ppx_expect",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_here",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_inline_test",
                                             "opam:v0.16.1"],
                                             ["@opam/ppxlib",
                                             "opam:0.32.1~5.2preview"],
                                             ["@opam/re", "opam:1.11.0"],
                                             ["@opam/stdio", "opam:v0.16.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/ppx_fields_conv",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__ppx__fields__conv__opam__c__v0.16.0__0add50a3/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.16.3"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/fieldslib",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_fields_conv",
                                             "opam:v0.16.0"],
                                             ["@opam/ppxlib",
                                             "opam:0.32.1~5.2preview"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/ppx_fixed_literal",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__ppx__fixed__literal__opam__c__v0.16.0__a7169fe0/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.16.3"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/ppx_fixed_literal",
                                             "opam:v0.16.0"],
                                             ["@opam/ppxlib",
                                             "opam:0.32.1~5.2preview"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/ppx_globalize",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__ppx__globalize__opam__c__v0.16.0__eaa2e20e/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.16.3"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/ppx_globalize",
                                             "opam:v0.16.0"],
                                             ["@opam/ppxlib",
                                             "opam:0.32.1~5.2preview"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/ppx_hash",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__ppx__hash__opam__c__v0.16.0__1f127c52/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.16.3"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/ppx_compare",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_hash",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_sexp_conv",
                                             "opam:v0.16.0"],
                                             ["@opam/ppxlib",
                                             "opam:0.32.1~5.2preview"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/ppx_here",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__ppx__here__opam__c__v0.16.0__3237dad1/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.16.3"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/ppx_here",
                                             "opam:v0.16.0"],
                                             ["@opam/ppxlib",
                                             "opam:0.32.1~5.2preview"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/ppx_ignore_instrumentation",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__ppx__ignore__instrumentation__opam__c__v0.16.0__eedff487/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/ppx_ignore_instrumentation",
                                             "opam:v0.16.0"],
                                             ["@opam/ppxlib",
                                             "opam:0.32.1~5.2preview"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/ppx_inline_test",
  new Map([["opam:v0.16.1",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__ppx__inline__test__opam__c__v0.16.1__e0f9693b/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.16.3"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/ppx_inline_test",
                                             "opam:v0.16.1"],
                                             ["@opam/ppxlib",
                                             "opam:0.32.1~5.2preview"],
                                             ["@opam/time_now",
                                             "opam:v0.16.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/ppx_jane",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__ppx__jane__opam__c__v0.16.0__cbd089a0/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base_quickcheck",
                                             "opam:v0.16.0"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/ppx_assert",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_base",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_bench",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_bin_prot",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_custom_printf",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_disable_unused_warnings",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_expect",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_fields_conv",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_fixed_literal",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_here",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_ignore_instrumentation",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_inline_test",
                                             "opam:v0.16.1"],
                                             ["@opam/ppx_jane",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_let",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_log",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_module_timer",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_optional",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_pipebang",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_sexp_message",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_sexp_value",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_stable",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_stable_witness",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_string",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_tydi",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_typerep_conv",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_variants_conv",
                                             "opam:v0.16.0"],
                                             ["@opam/ppxlib",
                                             "opam:0.32.1~5.2preview"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/ppx_let",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__ppx__let__opam__c__v0.16.0__32e28e00/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.16.3"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/ppx_here",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_let",
                                             "opam:v0.16.0"],
                                             ["@opam/ppxlib",
                                             "opam:0.32.1~5.2preview"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/ppx_log",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__ppx__log__opam__c__v0.16.0__9c092c0d/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.16.3"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/ppx_here",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_log",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_sexp_conv",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_sexp_message",
                                             "opam:v0.16.0"],
                                             ["@opam/ppxlib",
                                             "opam:0.32.1~5.2preview"],
                                             ["@opam/sexplib",
                                             "opam:v0.16.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/ppx_module_timer",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__ppx__module__timer__opam__c__v0.16.0__502e87fd/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.16.3"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/ppx_base",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_module_timer",
                                             "opam:v0.16.0"],
                                             ["@opam/ppxlib",
                                             "opam:0.32.1~5.2preview"],
                                             ["@opam/stdio", "opam:v0.16.0"],
                                             ["@opam/time_now",
                                             "opam:v0.16.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/ppx_optcomp",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__ppx__optcomp__opam__c__v0.16.0__3b1d9fa1/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.16.3"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/ppx_optcomp",
                                             "opam:v0.16.0"],
                                             ["@opam/ppxlib",
                                             "opam:0.32.1~5.2preview"],
                                             ["@opam/stdio", "opam:v0.16.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/ppx_optional",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__ppx__optional__opam__c__v0.16.0__e036a4e7/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.16.3"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/ppx_optional",
                                             "opam:v0.16.0"],
                                             ["@opam/ppxlib",
                                             "opam:0.32.1~5.2preview"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/ppx_pipebang",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__ppx__pipebang__opam__c__v0.16.0__4432e298/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/ppx_pipebang",
                                             "opam:v0.16.0"],
                                             ["@opam/ppxlib",
                                             "opam:0.32.1~5.2preview"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/ppx_sexp_conv",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__ppx__sexp__conv__opam__c__v0.16.0__2651ea55/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.16.3"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/ppx_sexp_conv",
                                             "opam:v0.16.0"],
                                             ["@opam/ppxlib",
                                             "opam:0.32.1~5.2preview"],
                                             ["@opam/sexplib0",
                                             "opam:v0.16.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/ppx_sexp_message",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__ppx__sexp__message__opam__c__v0.16.0__2cfee68b/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.16.3"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/ppx_here",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_sexp_conv",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_sexp_message",
                                             "opam:v0.16.0"],
                                             ["@opam/ppxlib",
                                             "opam:0.32.1~5.2preview"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/ppx_sexp_value",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__ppx__sexp__value__opam__c__v0.16.0__38441d56/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.16.3"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/ppx_here",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_sexp_conv",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_sexp_value",
                                             "opam:v0.16.0"],
                                             ["@opam/ppxlib",
                                             "opam:0.32.1~5.2preview"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/ppx_stable",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__ppx__stable__opam__c__v0.16.0__0a3166d0/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.16.3"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/ppx_stable",
                                             "opam:v0.16.0"],
                                             ["@opam/ppxlib",
                                             "opam:0.32.1~5.2preview"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/ppx_stable_witness",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__ppx__stable__witness__opam__c__v0.16.0__c567a155/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.16.3"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/ppx_stable_witness",
                                             "opam:v0.16.0"],
                                             ["@opam/ppxlib",
                                             "opam:0.32.1~5.2preview"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/ppx_string",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__ppx__string__opam__c__v0.16.0__212d398e/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.16.3"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/ppx_base",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_string",
                                             "opam:v0.16.0"],
                                             ["@opam/ppxlib",
                                             "opam:0.32.1~5.2preview"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/ppx_tydi",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__ppx__tydi__opam__c__v0.16.0__f1826de5/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.16.3"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/ppx_tydi",
                                             "opam:v0.16.0"],
                                             ["@opam/ppxlib",
                                             "opam:0.32.1~5.2preview"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/ppx_typerep_conv",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__ppx__typerep__conv__opam__c__v0.16.0__1fdad400/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.16.3"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/ppx_typerep_conv",
                                             "opam:v0.16.0"],
                                             ["@opam/ppxlib",
                                             "opam:0.32.1~5.2preview"],
                                             ["@opam/typerep",
                                             "opam:v0.16.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/ppx_variants_conv",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__ppx__variants__conv__opam__c__v0.16.0__7a82f21b/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.16.3"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/ppx_variants_conv",
                                             "opam:v0.16.0"],
                                             ["@opam/ppxlib",
                                             "opam:0.32.1~5.2preview"],
                                             ["@opam/variantslib",
                                             "opam:v0.16.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/ppx_yojson_conv_lib",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__ppx__yojson__conv__lib__opam__c__v0.16.0__d6ba8277/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/ppx_yojson_conv_lib",
                                             "opam:v0.16.0"],
                                             ["@opam/yojson", "opam:2.1.2"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/ppxlib",
  new Map([["opam:0.32.1~5.2preview",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__ppxlib__opam__c__0.32.1~5.2preview__a67f37ff/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/ocaml-compiler-libs",
                                             "opam:v0.12.4"],
                                             ["@opam/ppx_derivers",
                                             "opam:1.2.1"],
                                             ["@opam/ppxlib",
                                             "opam:0.32.1~5.2preview"],
                                             ["@opam/sexplib0",
                                             "opam:v0.16.0"],
                                             ["@opam/stdlib-shims",
                                             "opam:0.3.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/protocol_version_header",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__protocol__version__header__opam__c__v0.16.0__d8bcac43/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/core", "opam:v0.16.2"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/ppx_jane",
                                             "opam:v0.16.0"],
                                             ["@opam/protocol_version_header",
                                             "opam:v0.16.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/psq",
  new Map([["opam:0.2.1",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__psq__opam__c__0.2.1__dc38ca7c/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/psq", "opam:0.2.1"],
                                             ["@opam/seq", "opam:base"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/ptime",
  new Map([["opam:1.1.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__ptime__opam__c__1.1.0__4fdf2d49/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/ocamlbuild",
                                             "opam:0.14.3"],
                                             ["@opam/ocamlfind",
                                             "opam:1.9.6"],
                                             ["@opam/ptime", "opam:1.1.0"],
                                             ["@opam/topkg", "opam:1.0.7"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/re",
  new Map([["opam:1.11.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__re__opam__c__1.11.0__ec7ed84a/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/re", "opam:1.11.0"],
                                             ["@opam/seq", "opam:base"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/result",
  new Map([["opam:1.5",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__result__opam__c__1.5__74485f30/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/result", "opam:1.5"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/riot",
  new Map([["opam:0.0.5",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__riot__opam__c__0.0.5__6f9da3fa/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/bigstringaf",
                                             "opam:0.9.1"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/iomux", "opam:0.3"],
                                             ["@opam/ptime", "opam:1.1.0"],
                                             ["@opam/riot", "opam:0.0.5"],
                                             ["@opam/telemetry",
                                             "opam:0.0.1"],
                                             ["@opam/uri", "opam:4.4.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/runtime_events_tools",
  new Map([["opam:0.5.1",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__runtime__events__tools__opam__c__0.5.1__ac41eb4c/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/cmdliner", "opam:1.2.0"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/hdr_histogram",
                                             "opam:0.0.3"],
                                             ["@opam/ocaml_intrinsics",
                                             "opam:v0.16.1"],
                                             ["@opam/runtime_events_tools",
                                             "opam:0.5.1"],
                                             ["@opam/tracing",
                                             "opam:v0.16.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/seq",
  new Map([["opam:base",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__seq__opam__c__base__a0c677b1/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/seq", "opam:base"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/sexp_pretty",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__sexp__pretty__opam__c__v0.16.0__bb5ee3cb/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.16.3"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/ppx_base",
                                             "opam:v0.16.0"],
                                             ["@opam/re", "opam:1.11.0"],
                                             ["@opam/sexp_pretty",
                                             "opam:v0.16.0"],
                                             ["@opam/sexplib",
                                             "opam:v0.16.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/sexplib",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__sexplib__opam__c__v0.16.0__d9b43f25/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/num", "opam:1.5"],
                                             ["@opam/parsexp",
                                             "opam:v0.16.0"],
                                             ["@opam/sexplib",
                                             "opam:v0.16.0"],
                                             ["@opam/sexplib0",
                                             "opam:v0.16.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/sexplib0",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__sexplib0__opam__c__v0.16.0__c52bdb53/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/sexplib0",
                                             "opam:v0.16.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/spawn",
  new Map([["opam:v0.15.1",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__spawn__opam__c__v0.15.1__cdb37477/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/spawn", "opam:v0.15.1"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/spices",
  new Map([["opam:0.0.2",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__spices__opam__c__0.0.2__b0296561/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/colors", "opam:0.0.1"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/spices", "opam:0.0.2"],
                                             ["@opam/tty", "opam:0.0.2"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/splittable_random",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__splittable__random__opam__c__v0.16.0__6b8b7e35/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.16.3"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/ppx_assert",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_bench",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_inline_test",
                                             "opam:v0.16.1"],
                                             ["@opam/ppx_sexp_message",
                                             "opam:v0.16.0"],
                                             ["@opam/splittable_random",
                                             "opam:v0.16.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/stdio",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__stdio__opam__c__v0.16.0__77b6ea60/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.16.3"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/stdio", "opam:v0.16.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/stdlib-shims",
  new Map([["opam:0.3.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__stdlib_shims__opam__c__0.3.0__513c478f/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/stdlib-shims",
                                             "opam:0.3.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/stdune",
  new Map([["opam:3.14.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__stdune__opam__c__3.14.0__e6a38e70/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base-unix", "opam:base"],
                                             ["@opam/csexp", "opam:1.5.2"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/dyn", "opam:3.14.0"],
                                             ["@opam/ordering",
                                             "opam:3.14.0"],
                                             ["@opam/pp", "opam:1.2.0"],
                                             ["@opam/stdune", "opam:3.14.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/stringext",
  new Map([["opam:1.6.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__stringext__opam__c__1.6.0__199e37a7/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/stringext",
                                             "opam:1.6.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/telemetry",
  new Map([["opam:0.0.1",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__telemetry__opam__c__0.0.1__f942b031/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/telemetry",
                                             "opam:0.0.1"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/textutils",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__textutils__opam__c__v0.16.0__eeab42a2/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/core", "opam:v0.16.2"],
                                             ["@opam/core_kernel",
                                             "opam:v0.16.0"],
                                             ["@opam/core_unix",
                                             "opam:v0.16.0"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/ppx_jane",
                                             "opam:v0.16.0"],
                                             ["@opam/textutils",
                                             "opam:v0.16.0"],
                                             ["@opam/textutils_kernel",
                                             "opam:v0.16.0"],
                                             ["@opam/uutf", "opam:1.0.3"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/textutils_kernel",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__textutils__kernel__opam__c__v0.16.0__55f60636/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/core", "opam:v0.16.2"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/ppx_jane",
                                             "opam:v0.16.0"],
                                             ["@opam/textutils_kernel",
                                             "opam:v0.16.0"],
                                             ["@opam/uutf", "opam:1.0.3"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/thread-table",
  new Map([["opam:1.0.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__thread_table__opam__c__1.0.0__3462a301/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/thread-table",
                                             "opam:1.0.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/time_now",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__time__now__opam__c__v0.16.0__56d1991a/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.16.3"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/jane-street-headers",
                                             "opam:v0.16.0"],
                                             ["@opam/jst-config",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_base",
                                             "opam:v0.16.0"],
                                             ["@opam/ppx_optcomp",
                                             "opam:v0.16.0"],
                                             ["@opam/time_now",
                                             "opam:v0.16.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/timezone",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__timezone__opam__c__v0.16.0__60a5c090/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/core", "opam:v0.16.2"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/ppx_jane",
                                             "opam:v0.16.0"],
                                             ["@opam/timezone",
                                             "opam:v0.16.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/topkg",
  new Map([["opam:1.0.7",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__topkg__opam__c__1.0.7__64f1b51f/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/ocamlbuild",
                                             "opam:0.14.3"],
                                             ["@opam/ocamlfind",
                                             "opam:1.9.6"],
                                             ["@opam/topkg", "opam:1.0.7"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/tracing",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__tracing__opam__c__v0.16.0__f1f38bd3/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/async", "opam:v0.16.0"],
                                             ["@opam/core", "opam:v0.16.2"],
                                             ["@opam/core_kernel",
                                             "opam:v0.16.0"],
                                             ["@opam/core_unix",
                                             "opam:v0.16.0"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/ppx_jane",
                                             "opam:v0.16.0"],
                                             ["@opam/tracing",
                                             "opam:v0.16.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/tty",
  new Map([["opam:0.0.2",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__tty__opam__c__0.0.2__c29cc34e/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/tty", "opam:0.0.2"],
                                             ["@opam/uutf", "opam:1.0.3"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/typerep",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__typerep__opam__c__v0.16.0__cd1ddd0b/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.16.3"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/typerep",
                                             "opam:v0.16.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/uri",
  new Map([["opam:4.4.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__uri__opam__c__4.4.0__a39096eb/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/angstrom",
                                             "opam:0.16.0"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/stringext",
                                             "opam:1.6.0"],
                                             ["@opam/uri", "opam:4.4.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/uring",
  new Map([["opam:0.8",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__uring__opam__c__0.8__868d06bd/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/cstruct", "opam:6.2.0"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/dune-configurator",
                                             "opam:3.14.0"],
                                             ["@opam/fmt", "opam:0.9.0"],
                                             ["@opam/optint", "opam:0.3.0"],
                                             ["@opam/uring", "opam:0.8"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/uucp",
  new Map([["opam:15.1.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__uucp__opam__c__15.1.0__f2d65964/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/cmdliner", "opam:1.2.0"],
                                             ["@opam/ocamlbuild",
                                             "opam:0.14.3"],
                                             ["@opam/ocamlfind",
                                             "opam:1.9.6"],
                                             ["@opam/topkg", "opam:1.0.7"],
                                             ["@opam/uucp", "opam:15.1.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/uuseg",
  new Map([["opam:15.1.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__uuseg__opam__c__15.1.0__e80d3c43/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/cmdliner", "opam:1.2.0"],
                                             ["@opam/ocamlbuild",
                                             "opam:0.14.3"],
                                             ["@opam/ocamlfind",
                                             "opam:1.9.6"],
                                             ["@opam/topkg", "opam:1.0.7"],
                                             ["@opam/uucp", "opam:15.1.0"],
                                             ["@opam/uuseg", "opam:15.1.0"],
                                             ["@opam/uutf", "opam:1.0.3"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/uutf",
  new Map([["opam:1.0.3",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__uutf__opam__c__1.0.3__8c042452/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/cmdliner", "opam:1.2.0"],
                                             ["@opam/ocamlbuild",
                                             "opam:0.14.3"],
                                             ["@opam/ocamlfind",
                                             "opam:1.9.6"],
                                             ["@opam/topkg", "opam:1.0.7"],
                                             ["@opam/uutf", "opam:1.0.3"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/variantslib",
  new Map([["opam:v0.16.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__variantslib__opam__c__v0.16.0__8c164f06/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.16.3"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/variantslib",
                                             "opam:v0.16.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/xdg",
  new Map([["opam:3.14.0",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__xdg__opam__c__3.14.0__6ccae234/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/xdg", "opam:3.14.0"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["@opam/yojson",
  new Map([["opam:2.1.2",
           {
             packageLocation: "/home/sk/.esy/source/i/opam__s__yojson__opam__c__2.1.2__45cc3d11/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/cppo", "opam:1.6.9"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/seq", "opam:base"],
                                             ["@opam/yojson", "opam:2.1.2"],
                                             ["ocaml", "5.1.1"]])}]])],
  ["esy-libffi",
  new Map([["3.3.1",
           {
             packageLocation: "/home/sk/.esy/source/i/esy_libffi__3.3.1__6659ddae/",
             packageDependencies: new Map([["@opam/conf-texinfo",
                                           "github:esy-packages/esy-texinfo:package.json#4a05feafbbcc4c57d5d25899fbdab98961b9a69c"],
                                             ["esy-libffi", "3.3.1"]])}]])],
  ["esy-zlib",
  new Map([["github:esy-packages/esy-zlib#404929fd8b7ed83ed6a528d751840faff957b4b3",
           {
             packageLocation: "/home/sk/.esy/source/i/esy_zlib__6dd5a115/",
             packageDependencies: new Map([["esy-zlib",
                                           "github:esy-packages/esy-zlib#404929fd8b7ed83ed6a528d751840faff957b4b3"]])}]])],
  ["ocaml",
  new Map([["5.1.1",
           {
             packageLocation: "/home/sk/.esy/source/i/ocaml__5.1.1__f41e39e4/",
             packageDependencies: new Map([["ocaml", "5.1.1"]])}]])],
  ["yarn-pkg-config",
  new Map([["github:esy-ocaml/yarn-pkg-config#db3a0b63883606dd57c54a7158d560d6cba8cd79",
           {
             packageLocation: "/home/sk/.esy/source/i/yarn_pkg_config__9829fc81/",
             packageDependencies: new Map([["yarn-pkg-config",
                                           "github:esy-ocaml/yarn-pkg-config#db3a0b63883606dd57c54a7158d560d6cba8cd79"]])}]])],
  [null,
  new Map([[null,
           {
             packageLocation: "/home/sk/cdf-olly-plots/",
             packageDependencies: new Map([["@opam/dot-merlin-reader",
                                           "opam:4.9"],
                                             ["@opam/dune", "opam:3.14.0"],
                                             ["@opam/eio", "opam:0.15"],
                                             ["@opam/eio_main", "opam:0.15"],
                                             ["@opam/leaves", "opam:0.0.2"],
                                             ["@opam/minttea", "opam:0.0.2"],
                                             ["@opam/ocaml-lsp-server",
                                             "opam:1.17.0"],
                                             ["@opam/ocamlformat",
                                             "opam:0.26.1"],
                                             ["@opam/runtime_events_tools",
                                             "opam:0.5.1"],
                                             ["@opam/spices", "opam:0.0.2"],
                                             ["ocaml", "5.1.1"]])}]])]]);

let topLevelLocatorPath = "../../";

let locatorsByLocations = new Map([
["../../", topLevelLocator],
  ["../../../.esy/source/i/esy_libffi__3.3.1__6659ddae/",
  {
    name: "esy-libffi",
    reference: "3.3.1"}],
  ["../../../.esy/source/i/esy_ocaml__s__substs__0.0.1__19de1ee1/",
  {
    name: "@esy-ocaml/substs",
    reference: "0.0.1"}],
  ["../../../.esy/source/i/esy_zlib__6dd5a115/",
  {
    name: "esy-zlib",
    reference: "github:esy-packages/esy-zlib#404929fd8b7ed83ed6a528d751840faff957b4b3"}],
  ["../../../.esy/source/i/ocaml__5.1.1__f41e39e4/",
  {
    name: "ocaml",
    reference: "5.1.1"}],
  ["../../../.esy/source/i/opam__s__angstrom__opam__c__0.16.0__d7090c1e/",
  {
    name: "@opam/angstrom",
    reference: "opam:0.16.0"}],
  ["../../../.esy/source/i/opam__s__astring__opam__c__0.8.5__471b9e4a/",
  {
    name: "@opam/astring",
    reference: "opam:0.8.5"}],
  ["../../../.esy/source/i/opam__s__async__kernel__opam__c__v0.16.0__cbe62377/",
  {
    name: "@opam/async_kernel",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__async__opam__c__v0.16.0__5d6e5d97/",
  {
    name: "@opam/async",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__async__rpc__kernel__opam__c__v0.16.0__99ba00b0/",
  {
    name: "@opam/async_rpc_kernel",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__async__unix__opam__c__v0.16.0__8e3b2d0e/",
  {
    name: "@opam/async_unix",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__base__bigstring__opam__c__v0.16.0__a521851b/",
  {
    name: "@opam/base_bigstring",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__base__opam__c__v0.16.3__eb58c630/",
  {
    name: "@opam/base",
    reference: "opam:v0.16.3"}],
  ["../../../.esy/source/i/opam__s__base__quickcheck__opam__c__v0.16.0__f39878e5/",
  {
    name: "@opam/base_quickcheck",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__base_bytes__opam__c__base__48b6019a/",
  {
    name: "@opam/base-bytes",
    reference: "opam:base"}],
  ["../../../.esy/source/i/opam__s__base_threads__opam__c__base__f282958b/",
  {
    name: "@opam/base-threads",
    reference: "opam:base"}],
  ["../../../.esy/source/i/opam__s__base_unix__opam__c__base__93427a57/",
  {
    name: "@opam/base-unix",
    reference: "opam:base"}],
  ["../../../.esy/source/i/opam__s__bigarray_compat__opam__c__1.1.0__ec432e34/",
  {
    name: "@opam/bigarray-compat",
    reference: "opam:1.1.0"}],
  ["../../../.esy/source/i/opam__s__bigstringaf__opam__c__0.9.1__94edc918/",
  {
    name: "@opam/bigstringaf",
    reference: "opam:0.9.1"}],
  ["../../../.esy/source/i/opam__s__bin__prot__opam__c__v0.16.0__4f3cd1db/",
  {
    name: "@opam/bin_prot",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__camlp_streams__opam__c__5.0.1__35498539/",
  {
    name: "@opam/camlp-streams",
    reference: "opam:5.0.1"}],
  ["../../../.esy/source/i/opam__s__chrome_trace__opam__c__3.14.0__6be1334a/",
  {
    name: "@opam/chrome-trace",
    reference: "opam:3.14.0"}],
  ["../../../.esy/source/i/opam__s__cmdliner__opam__c__1.2.0__9a2a11b5/",
  {
    name: "@opam/cmdliner",
    reference: "opam:1.2.0"}],
  ["../../../.esy/source/i/opam__s__colors__opam__c__0.0.1__55e3b4eb/",
  {
    name: "@opam/colors",
    reference: "opam:0.0.1"}],
  ["../../../.esy/source/i/opam__s__conf_bash__opam__c__1__6a489164/",
  {
    name: "@opam/conf-bash",
    reference: "opam:1"}],
  ["../../../.esy/source/i/opam__s__conf_cmake__opam__c__1__82f13c88/",
  {
    name: "@opam/conf-cmake",
    reference: "opam:1"}],
  ["../../../.esy/source/i/opam__s__conf_libffi__opam__c__2.0.0__16382ec8/",
  {
    name: "@opam/conf-libffi",
    reference: "opam:2.0.0"}],
  ["../../../.esy/source/i/opam__s__conf_pkg_config__opam__c__2__a15208ab/",
  {
    name: "@opam/conf-pkg-config",
    reference: "opam:2"}],
  ["../../../.esy/source/i/opam__s__conf_texinfo__358d35e6/",
  {
    name: "@opam/conf-texinfo",
    reference: "github:esy-packages/esy-texinfo:package.json#4a05feafbbcc4c57d5d25899fbdab98961b9a69c"}],
  ["../../../.esy/source/i/opam__s__conf_zlib__opam__c__1__80da1441/",
  {
    name: "@opam/conf-zlib",
    reference: "opam:1"}],
  ["../../../.esy/source/i/opam__s__core__kernel__opam__c__v0.16.0__073f3c34/",
  {
    name: "@opam/core_kernel",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__core__opam__c__v0.16.2__8fbbe674/",
  {
    name: "@opam/core",
    reference: "opam:v0.16.2"}],
  ["../../../.esy/source/i/opam__s__core__unix__opam__c__v0.16.0__318b914f/",
  {
    name: "@opam/core_unix",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__cppo__opam__c__1.6.9__327e8fcf/",
  {
    name: "@opam/cppo",
    reference: "opam:1.6.9"}],
  ["../../../.esy/source/i/opam__s__csexp__opam__c__1.5.2__d986413e/",
  {
    name: "@opam/csexp",
    reference: "opam:1.5.2"}],
  ["../../../.esy/source/i/opam__s__cstruct__opam__c__6.2.0__cdef52c2/",
  {
    name: "@opam/cstruct",
    reference: "opam:6.2.0"}],
  ["../../../.esy/source/i/opam__s__ctypes__opam__c__0.22.0__72ae3932/",
  {
    name: "@opam/ctypes",
    reference: "opam:0.22.0"}],
  ["../../../.esy/source/i/opam__s__ctypes_foreign__opam__c__0.22.0__e3aa7450/",
  {
    name: "@opam/ctypes-foreign",
    reference: "opam:0.22.0"}],
  ["../../../.esy/source/i/opam__s__domain_local_await__opam__c__1.0.1__ba2e773a/",
  {
    name: "@opam/domain-local-await",
    reference: "opam:1.0.1"}],
  ["../../../.esy/source/i/opam__s__dot_merlin_reader__opam__c__4.9__eb22f8e0/",
  {
    name: "@opam/dot-merlin-reader",
    reference: "opam:4.9"}],
  ["../../../.esy/source/i/opam__s__dune__opam__c__3.14.0__79f978ef/",
  {
    name: "@opam/dune",
    reference: "opam:3.14.0"}],
  ["../../../.esy/source/i/opam__s__dune_build_info__opam__c__3.14.0__824091b1/",
  {
    name: "@opam/dune-build-info",
    reference: "opam:3.14.0"}],
  ["../../../.esy/source/i/opam__s__dune_configurator__opam__c__3.14.0__bdbedf02/",
  {
    name: "@opam/dune-configurator",
    reference: "opam:3.14.0"}],
  ["../../../.esy/source/i/opam__s__dune_rpc__opam__c__3.14.0__d565b221/",
  {
    name: "@opam/dune-rpc",
    reference: "opam:3.14.0"}],
  ["../../../.esy/source/i/opam__s__dyn__opam__c__3.14.0__8f471f60/",
  {
    name: "@opam/dyn",
    reference: "opam:3.14.0"}],
  ["../../../.esy/source/i/opam__s__eio__linux__opam__c__0.15__361ca0df/",
  {
    name: "@opam/eio_linux",
    reference: "opam:0.15"}],
  ["../../../.esy/source/i/opam__s__eio__main__opam__c__0.15__6a0c6284/",
  {
    name: "@opam/eio_main",
    reference: "opam:0.15"}],
  ["../../../.esy/source/i/opam__s__eio__opam__c__0.15__6732392c/",
  {
    name: "@opam/eio",
    reference: "opam:0.15"}],
  ["../../../.esy/source/i/opam__s__eio__posix__opam__c__0.15__d55f4b42/",
  {
    name: "@opam/eio_posix",
    reference: "opam:0.15"}],
  ["../../../.esy/source/i/opam__s__eio__windows__opam__c__0.15__368bbf8a/",
  {
    name: "@opam/eio_windows",
    reference: "opam:0.15"}],
  ["../../../.esy/source/i/opam__s__either__opam__c__1.0.0__29ca51fc/",
  {
    name: "@opam/either",
    reference: "opam:1.0.0"}],
  ["../../../.esy/source/i/opam__s__expect__test__helpers__core__opam__c__v0.16.0__3360ec87/",
  {
    name: "@opam/expect_test_helpers_core",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__fiber__opam__c__3.7.0__283d7f54/",
  {
    name: "@opam/fiber",
    reference: "opam:3.7.0"}],
  ["../../../.esy/source/i/opam__s__fieldslib__opam__c__v0.16.0__9ca901db/",
  {
    name: "@opam/fieldslib",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__fix__opam__c__20230505__c9f697a2/",
  {
    name: "@opam/fix",
    reference: "opam:20230505"}],
  ["../../../.esy/source/i/opam__s__fmt__opam__c__0.9.0__2f7f274d/",
  {
    name: "@opam/fmt",
    reference: "opam:0.9.0"}],
  ["../../../.esy/source/i/opam__s__fpath__opam__c__0.7.3__18652e33/",
  {
    name: "@opam/fpath",
    reference: "opam:0.7.3"}],
  ["../../../.esy/source/i/opam__s__hdr__histogram__opam__c__0.0.3__f683092c/",
  {
    name: "@opam/hdr_histogram",
    reference: "opam:0.0.3"}],
  ["../../../.esy/source/i/opam__s__hmap__opam__c__0.8.1__f8cac8ba/",
  {
    name: "@opam/hmap",
    reference: "opam:0.8.1"}],
  ["../../../.esy/source/i/opam__s__int__repr__opam__c__v0.16.0__fe4e971e/",
  {
    name: "@opam/int_repr",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__integers__opam__c__0.7.0__10894044/",
  {
    name: "@opam/integers",
    reference: "opam:0.7.0"}],
  ["../../../.esy/source/i/opam__s__iomux__opam__c__0.3__263e94a1/",
  {
    name: "@opam/iomux",
    reference: "opam:0.3"}],
  ["../../../.esy/source/i/opam__s__jane_street_headers__opam__c__v0.16.0__577c46ab/",
  {
    name: "@opam/jane-street-headers",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__jst_config__opam__c__v0.16.0__cf378de6/",
  {
    name: "@opam/jst-config",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__leaves__opam__c__0.0.2__ec395a6b/",
  {
    name: "@opam/leaves",
    reference: "opam:0.0.2"}],
  ["../../../.esy/source/i/opam__s__logs__opam__c__0.7.0__da3c2fe0/",
  {
    name: "@opam/logs",
    reference: "opam:0.7.0"}],
  ["../../../.esy/source/i/opam__s__lwt_dllist__opam__c__1.0.1__19ad5258/",
  {
    name: "@opam/lwt-dllist",
    reference: "opam:1.0.1"}],
  ["../../../.esy/source/i/opam__s__menhir__opam__c__20231231__e3fcfc8d/",
  {
    name: "@opam/menhir",
    reference: "opam:20231231"}],
  ["../../../.esy/source/i/opam__s__menhircst__opam__c__20231231__dd9c625c/",
  {
    name: "@opam/menhirCST",
    reference: "opam:20231231"}],
  ["../../../.esy/source/i/opam__s__menhirlib__opam__c__20231231__c74d66e3/",
  {
    name: "@opam/menhirLib",
    reference: "opam:20231231"}],
  ["../../../.esy/source/i/opam__s__menhirsdk__opam__c__20231231__9e75caf2/",
  {
    name: "@opam/menhirSdk",
    reference: "opam:20231231"}],
  ["../../../.esy/source/i/opam__s__merlin_lib__opam__c__4.13_501__1099d3d4/",
  {
    name: "@opam/merlin-lib",
    reference: "opam:4.13-501"}],
  ["../../../.esy/source/i/opam__s__minttea__opam__c__0.0.2__20156ee4/",
  {
    name: "@opam/minttea",
    reference: "opam:0.0.2"}],
  ["../../../.esy/source/i/opam__s__mtime__opam__c__2.0.0__012608b8/",
  {
    name: "@opam/mtime",
    reference: "opam:2.0.0"}],
  ["../../../.esy/source/i/opam__s__num__opam__c__1.5__494b8cb1/",
  {
    name: "@opam/num",
    reference: "opam:1.5"}],
  ["../../../.esy/source/i/opam__s__ocaml__intrinsics__opam__c__v0.16.1__cb31a101/",
  {
    name: "@opam/ocaml_intrinsics",
    reference: "opam:v0.16.1"}],
  ["../../../.esy/source/i/opam__s__ocaml_compiler_libs__opam__c__v0.12.4__3bec24dd/",
  {
    name: "@opam/ocaml-compiler-libs",
    reference: "opam:v0.12.4"}],
  ["../../../.esy/source/i/opam__s__ocaml_lsp_server__opam__c__1.17.0__d7ff5a04/",
  {
    name: "@opam/ocaml-lsp-server",
    reference: "opam:1.17.0"}],
  ["../../../.esy/source/i/opam__s__ocaml_syntax_shims__opam__c__1.0.0__cb8d5a09/",
  {
    name: "@opam/ocaml-syntax-shims",
    reference: "opam:1.0.0"}],
  ["../../../.esy/source/i/opam__s__ocaml_version__opam__c__3.6.4__f15fa505/",
  {
    name: "@opam/ocaml-version",
    reference: "opam:3.6.4"}],
  ["../../../.esy/source/i/opam__s__ocamlbuild__opam__c__0.14.3__32886626/",
  {
    name: "@opam/ocamlbuild",
    reference: "opam:0.14.3"}],
  ["../../../.esy/source/i/opam__s__ocamlc_loc__opam__c__3.14.0__5fc381be/",
  {
    name: "@opam/ocamlc-loc",
    reference: "opam:3.14.0"}],
  ["../../../.esy/source/i/opam__s__ocamlfind__opam__c__1.9.6__84cbadfb/",
  {
    name: "@opam/ocamlfind",
    reference: "opam:1.9.6"}],
  ["../../../.esy/source/i/opam__s__ocamlformat__opam__c__0.26.1__595e9d3a/",
  {
    name: "@opam/ocamlformat",
    reference: "opam:0.26.1"}],
  ["../../../.esy/source/i/opam__s__ocamlformat_lib__opam__c__0.26.1__3b3acef7/",
  {
    name: "@opam/ocamlformat-lib",
    reference: "opam:0.26.1"}],
  ["../../../.esy/source/i/opam__s__ocamlformat_rpc_lib__opam__c__0.26.1__a36a26dd/",
  {
    name: "@opam/ocamlformat-rpc-lib",
    reference: "opam:0.26.1"}],
  ["../../../.esy/source/i/opam__s__ocp_indent__opam__c__1.8.1__2297d668/",
  {
    name: "@opam/ocp-indent",
    reference: "opam:1.8.1"}],
  ["../../../.esy/source/i/opam__s__optint__opam__c__0.3.0__8f8a701d/",
  {
    name: "@opam/optint",
    reference: "opam:0.3.0"}],
  ["../../../.esy/source/i/opam__s__ordering__opam__c__3.14.0__4a5b1f49/",
  {
    name: "@opam/ordering",
    reference: "opam:3.14.0"}],
  ["../../../.esy/source/i/opam__s__parsexp__opam__c__v0.16.0__e936b5ec/",
  {
    name: "@opam/parsexp",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__pp__opam__c__1.2.0__d0b5cd43/",
  {
    name: "@opam/pp",
    reference: "opam:1.2.0"}],
  ["../../../.esy/source/i/opam__s__ppx__assert__opam__c__v0.16.0__b2c7938a/",
  {
    name: "@opam/ppx_assert",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__ppx__base__opam__c__v0.16.0__53eafdee/",
  {
    name: "@opam/ppx_base",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__ppx__bench__opam__c__v0.16.0__6cbeaa74/",
  {
    name: "@opam/ppx_bench",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__ppx__bin__prot__opam__c__v0.16.0__b6af2fa8/",
  {
    name: "@opam/ppx_bin_prot",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__ppx__cold__opam__c__v0.16.0__b113545b/",
  {
    name: "@opam/ppx_cold",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__ppx__compare__opam__c__v0.16.0__54fc0164/",
  {
    name: "@opam/ppx_compare",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__ppx__custom__printf__opam__c__v0.16.0__10b69edc/",
  {
    name: "@opam/ppx_custom_printf",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__ppx__derivers__opam__c__1.2.1__136a746e/",
  {
    name: "@opam/ppx_derivers",
    reference: "opam:1.2.1"}],
  ["../../../.esy/source/i/opam__s__ppx__disable__unused__warnings__opam__c__v0.16.0__d159d814/",
  {
    name: "@opam/ppx_disable_unused_warnings",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__ppx__enumerate__opam__c__v0.16.0__dcd077a7/",
  {
    name: "@opam/ppx_enumerate",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__ppx__expect__opam__c__v0.16.0__8aa11f3c/",
  {
    name: "@opam/ppx_expect",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__ppx__fields__conv__opam__c__v0.16.0__0add50a3/",
  {
    name: "@opam/ppx_fields_conv",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__ppx__fixed__literal__opam__c__v0.16.0__a7169fe0/",
  {
    name: "@opam/ppx_fixed_literal",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__ppx__globalize__opam__c__v0.16.0__eaa2e20e/",
  {
    name: "@opam/ppx_globalize",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__ppx__hash__opam__c__v0.16.0__1f127c52/",
  {
    name: "@opam/ppx_hash",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__ppx__here__opam__c__v0.16.0__3237dad1/",
  {
    name: "@opam/ppx_here",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__ppx__ignore__instrumentation__opam__c__v0.16.0__eedff487/",
  {
    name: "@opam/ppx_ignore_instrumentation",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__ppx__inline__test__opam__c__v0.16.1__e0f9693b/",
  {
    name: "@opam/ppx_inline_test",
    reference: "opam:v0.16.1"}],
  ["../../../.esy/source/i/opam__s__ppx__jane__opam__c__v0.16.0__cbd089a0/",
  {
    name: "@opam/ppx_jane",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__ppx__let__opam__c__v0.16.0__32e28e00/",
  {
    name: "@opam/ppx_let",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__ppx__log__opam__c__v0.16.0__9c092c0d/",
  {
    name: "@opam/ppx_log",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__ppx__module__timer__opam__c__v0.16.0__502e87fd/",
  {
    name: "@opam/ppx_module_timer",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__ppx__optcomp__opam__c__v0.16.0__3b1d9fa1/",
  {
    name: "@opam/ppx_optcomp",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__ppx__optional__opam__c__v0.16.0__e036a4e7/",
  {
    name: "@opam/ppx_optional",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__ppx__pipebang__opam__c__v0.16.0__4432e298/",
  {
    name: "@opam/ppx_pipebang",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__ppx__sexp__conv__opam__c__v0.16.0__2651ea55/",
  {
    name: "@opam/ppx_sexp_conv",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__ppx__sexp__message__opam__c__v0.16.0__2cfee68b/",
  {
    name: "@opam/ppx_sexp_message",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__ppx__sexp__value__opam__c__v0.16.0__38441d56/",
  {
    name: "@opam/ppx_sexp_value",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__ppx__stable__opam__c__v0.16.0__0a3166d0/",
  {
    name: "@opam/ppx_stable",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__ppx__stable__witness__opam__c__v0.16.0__c567a155/",
  {
    name: "@opam/ppx_stable_witness",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__ppx__string__opam__c__v0.16.0__212d398e/",
  {
    name: "@opam/ppx_string",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__ppx__tydi__opam__c__v0.16.0__f1826de5/",
  {
    name: "@opam/ppx_tydi",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__ppx__typerep__conv__opam__c__v0.16.0__1fdad400/",
  {
    name: "@opam/ppx_typerep_conv",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__ppx__variants__conv__opam__c__v0.16.0__7a82f21b/",
  {
    name: "@opam/ppx_variants_conv",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__ppx__yojson__conv__lib__opam__c__v0.16.0__d6ba8277/",
  {
    name: "@opam/ppx_yojson_conv_lib",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__ppxlib__opam__c__0.32.1~5.2preview__a67f37ff/",
  {
    name: "@opam/ppxlib",
    reference: "opam:0.32.1~5.2preview"}],
  ["../../../.esy/source/i/opam__s__protocol__version__header__opam__c__v0.16.0__d8bcac43/",
  {
    name: "@opam/protocol_version_header",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__psq__opam__c__0.2.1__dc38ca7c/",
  {
    name: "@opam/psq",
    reference: "opam:0.2.1"}],
  ["../../../.esy/source/i/opam__s__ptime__opam__c__1.1.0__4fdf2d49/",
  {
    name: "@opam/ptime",
    reference: "opam:1.1.0"}],
  ["../../../.esy/source/i/opam__s__re__opam__c__1.11.0__ec7ed84a/",
  {
    name: "@opam/re",
    reference: "opam:1.11.0"}],
  ["../../../.esy/source/i/opam__s__result__opam__c__1.5__74485f30/",
  {
    name: "@opam/result",
    reference: "opam:1.5"}],
  ["../../../.esy/source/i/opam__s__riot__opam__c__0.0.5__6f9da3fa/",
  {
    name: "@opam/riot",
    reference: "opam:0.0.5"}],
  ["../../../.esy/source/i/opam__s__runtime__events__tools__opam__c__0.5.1__ac41eb4c/",
  {
    name: "@opam/runtime_events_tools",
    reference: "opam:0.5.1"}],
  ["../../../.esy/source/i/opam__s__seq__opam__c__base__a0c677b1/",
  {
    name: "@opam/seq",
    reference: "opam:base"}],
  ["../../../.esy/source/i/opam__s__sexp__pretty__opam__c__v0.16.0__bb5ee3cb/",
  {
    name: "@opam/sexp_pretty",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__sexplib0__opam__c__v0.16.0__c52bdb53/",
  {
    name: "@opam/sexplib0",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__sexplib__opam__c__v0.16.0__d9b43f25/",
  {
    name: "@opam/sexplib",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__spawn__opam__c__v0.15.1__cdb37477/",
  {
    name: "@opam/spawn",
    reference: "opam:v0.15.1"}],
  ["../../../.esy/source/i/opam__s__spices__opam__c__0.0.2__b0296561/",
  {
    name: "@opam/spices",
    reference: "opam:0.0.2"}],
  ["../../../.esy/source/i/opam__s__splittable__random__opam__c__v0.16.0__6b8b7e35/",
  {
    name: "@opam/splittable_random",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__stdio__opam__c__v0.16.0__77b6ea60/",
  {
    name: "@opam/stdio",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__stdlib_shims__opam__c__0.3.0__513c478f/",
  {
    name: "@opam/stdlib-shims",
    reference: "opam:0.3.0"}],
  ["../../../.esy/source/i/opam__s__stdune__opam__c__3.14.0__e6a38e70/",
  {
    name: "@opam/stdune",
    reference: "opam:3.14.0"}],
  ["../../../.esy/source/i/opam__s__stringext__opam__c__1.6.0__199e37a7/",
  {
    name: "@opam/stringext",
    reference: "opam:1.6.0"}],
  ["../../../.esy/source/i/opam__s__telemetry__opam__c__0.0.1__f942b031/",
  {
    name: "@opam/telemetry",
    reference: "opam:0.0.1"}],
  ["../../../.esy/source/i/opam__s__textutils__kernel__opam__c__v0.16.0__55f60636/",
  {
    name: "@opam/textutils_kernel",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__textutils__opam__c__v0.16.0__eeab42a2/",
  {
    name: "@opam/textutils",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__thread_table__opam__c__1.0.0__3462a301/",
  {
    name: "@opam/thread-table",
    reference: "opam:1.0.0"}],
  ["../../../.esy/source/i/opam__s__time__now__opam__c__v0.16.0__56d1991a/",
  {
    name: "@opam/time_now",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__timezone__opam__c__v0.16.0__60a5c090/",
  {
    name: "@opam/timezone",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__topkg__opam__c__1.0.7__64f1b51f/",
  {
    name: "@opam/topkg",
    reference: "opam:1.0.7"}],
  ["../../../.esy/source/i/opam__s__tracing__opam__c__v0.16.0__f1f38bd3/",
  {
    name: "@opam/tracing",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__tty__opam__c__0.0.2__c29cc34e/",
  {
    name: "@opam/tty",
    reference: "opam:0.0.2"}],
  ["../../../.esy/source/i/opam__s__typerep__opam__c__v0.16.0__cd1ddd0b/",
  {
    name: "@opam/typerep",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__uri__opam__c__4.4.0__a39096eb/",
  {
    name: "@opam/uri",
    reference: "opam:4.4.0"}],
  ["../../../.esy/source/i/opam__s__uring__opam__c__0.8__868d06bd/",
  {
    name: "@opam/uring",
    reference: "opam:0.8"}],
  ["../../../.esy/source/i/opam__s__uucp__opam__c__15.1.0__f2d65964/",
  {
    name: "@opam/uucp",
    reference: "opam:15.1.0"}],
  ["../../../.esy/source/i/opam__s__uuseg__opam__c__15.1.0__e80d3c43/",
  {
    name: "@opam/uuseg",
    reference: "opam:15.1.0"}],
  ["../../../.esy/source/i/opam__s__uutf__opam__c__1.0.3__8c042452/",
  {
    name: "@opam/uutf",
    reference: "opam:1.0.3"}],
  ["../../../.esy/source/i/opam__s__variantslib__opam__c__v0.16.0__8c164f06/",
  {
    name: "@opam/variantslib",
    reference: "opam:v0.16.0"}],
  ["../../../.esy/source/i/opam__s__xdg__opam__c__3.14.0__6ccae234/",
  {
    name: "@opam/xdg",
    reference: "opam:3.14.0"}],
  ["../../../.esy/source/i/opam__s__yojson__opam__c__2.1.2__45cc3d11/",
  {
    name: "@opam/yojson",
    reference: "opam:2.1.2"}],
  ["../../../.esy/source/i/yarn_pkg_config__9829fc81/",
  {
    name: "yarn-pkg-config",
    reference: "github:esy-ocaml/yarn-pkg-config#db3a0b63883606dd57c54a7158d560d6cba8cd79"}]]);


  exports.findPackageLocator = function findPackageLocator(location) {
    let relativeLocation = normalizePath(path.relative(__dirname, location));

    if (!relativeLocation.match(isStrictRegExp))
      relativeLocation = `./${relativeLocation}`;

    if (location.match(isDirRegExp) && relativeLocation.charAt(relativeLocation.length - 1) !== '/')
      relativeLocation = `${relativeLocation}/`;

    let match;

  
      if (relativeLocation.length >= 91 && relativeLocation[90] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 91)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 89 && relativeLocation[88] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 89)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 88 && relativeLocation[87] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 88)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 86 && relativeLocation[85] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 86)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 83 && relativeLocation[82] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 83)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 81 && relativeLocation[80] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 81)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 80 && relativeLocation[79] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 80)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 79 && relativeLocation[78] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 79)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 78 && relativeLocation[77] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 78)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 77 && relativeLocation[76] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 77)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 76 && relativeLocation[75] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 76)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 75 && relativeLocation[74] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 75)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 74 && relativeLocation[73] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 74)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 73 && relativeLocation[72] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 73)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 72 && relativeLocation[71] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 72)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 71 && relativeLocation[70] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 71)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 70 && relativeLocation[69] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 70)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 69 && relativeLocation[68] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 69)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 68 && relativeLocation[67] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 68)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 67 && relativeLocation[66] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 67)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 66 && relativeLocation[65] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 66)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 65 && relativeLocation[64] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 65)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 64 && relativeLocation[63] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 64)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 63 && relativeLocation[62] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 63)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 62 && relativeLocation[61] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 62)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 61 && relativeLocation[60] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 61)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 60 && relativeLocation[59] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 60)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 55 && relativeLocation[54] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 55)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 51 && relativeLocation[50] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 51)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 49 && relativeLocation[48] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 49)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 46 && relativeLocation[45] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 46)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 42 && relativeLocation[41] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 42)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 6 && relativeLocation[5] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 6)))
          return blacklistCheck(match);
      

    /*
      this can only happen if inside the _esy
      as any other path will implies the opposite

      topLevelLocatorPath = ../../

      | folder              | relativeLocation |
      | ------------------- | ---------------- |
      | /workspace/app      | ../../           |
      | /workspace          | ../../../        |
      | /workspace/app/x    | ../../x/         |
      | /workspace/app/_esy | ../              |

    */
    if (!relativeLocation.startsWith(topLevelLocatorPath)) {
      return topLevelLocator;
    }
    return null;
  };
  


/**
 * Returns the module that should be used to resolve require calls. It's usually the direct parent, except if we're
 * inside an eval expression.
 */

function getIssuerModule(parent) {
  let issuer = parent;

  while (issuer && (issuer.id === '[eval]' || issuer.id === '<repl>' || !issuer.filename)) {
    issuer = issuer.parent;
  }

  return issuer;
}

/**
 * Returns information about a package in a safe way (will throw if they cannot be retrieved)
 */

function getPackageInformationSafe(packageLocator) {
  const packageInformation = exports.getPackageInformation(packageLocator);

  if (!packageInformation) {
    throw makeError(
      `INTERNAL`,
      `Couldn't find a matching entry in the dependency tree for the specified parent (this is probably an internal error)`
    );
  }

  return packageInformation;
}

/**
 * Implements the node resolution for folder access and extension selection
 */

function applyNodeExtensionResolution(unqualifiedPath, {extensions}) {
  // We use this "infinite while" so that we can restart the process as long as we hit package folders
  while (true) {
    let stat;

    try {
      stat = statSync(unqualifiedPath);
    } catch (error) {}

    // If the file exists and is a file, we can stop right there

    if (stat && !stat.isDirectory()) {
      // If the very last component of the resolved path is a symlink to a file, we then resolve it to a file. We only
      // do this first the last component, and not the rest of the path! This allows us to support the case of bin
      // symlinks, where a symlink in "/xyz/pkg-name/.bin/bin-name" will point somewhere else (like "/xyz/pkg-name/index.js").
      // In such a case, we want relative requires to be resolved relative to "/xyz/pkg-name/" rather than "/xyz/pkg-name/.bin/".
      //
      // Also note that the reason we must use readlink on the last component (instead of realpath on the whole path)
      // is that we must preserve the other symlinks, in particular those used by pnp to deambiguate packages using
      // peer dependencies. For example, "/xyz/.pnp/local/pnp-01234569/.bin/bin-name" should see its relative requires
      // be resolved relative to "/xyz/.pnp/local/pnp-0123456789/" rather than "/xyz/pkg-with-peers/", because otherwise
      // we would lose the information that would tell us what are the dependencies of pkg-with-peers relative to its
      // ancestors.

      if (lstatSync(unqualifiedPath).isSymbolicLink()) {
        unqualifiedPath = path.normalize(path.resolve(path.dirname(unqualifiedPath), readlinkSync(unqualifiedPath)));
      }

      return unqualifiedPath;
    }

    // If the file is a directory, we must check if it contains a package.json with a "main" entry

    if (stat && stat.isDirectory()) {
      let pkgJson;

      try {
        pkgJson = JSON.parse(readFileSync(`${unqualifiedPath}/package.json`, 'utf-8'));
      } catch (error) {}

      let nextUnqualifiedPath;

      if (pkgJson && pkgJson.main) {
        nextUnqualifiedPath = path.resolve(unqualifiedPath, pkgJson.main);
      }

      // If the "main" field changed the path, we start again from this new location

      if (nextUnqualifiedPath && nextUnqualifiedPath !== unqualifiedPath) {
        const resolution = applyNodeExtensionResolution(nextUnqualifiedPath, {extensions});

        if (resolution !== null) {
          return resolution;
        }
      }
    }

    // Otherwise we check if we find a file that match one of the supported extensions

    const qualifiedPath = extensions
      .map(extension => {
        return `${unqualifiedPath}${extension}`;
      })
      .find(candidateFile => {
        return existsSync(candidateFile);
      });

    if (qualifiedPath) {
      return qualifiedPath;
    }

    // Otherwise, we check if the path is a folder - in such a case, we try to use its index

    if (stat && stat.isDirectory()) {
      const indexPath = extensions
        .map(extension => {
          return `${unqualifiedPath}/index${extension}`;
        })
        .find(candidateFile => {
          return existsSync(candidateFile);
        });

      if (indexPath) {
        return indexPath;
      }
    }

    // Otherwise there's nothing else we can do :(

    return null;
  }
}

/**
 * This function creates fake modules that can be used with the _resolveFilename function.
 * Ideally it would be nice to be able to avoid this, since it causes useless allocations
 * and cannot be cached efficiently (we recompute the nodeModulePaths every time).
 *
 * Fortunately, this should only affect the fallback, and there hopefully shouldn't be a
 * lot of them.
 */

function makeFakeModule(path) {
  const fakeModule = new Module(path, false);
  fakeModule.filename = path;
  fakeModule.paths = Module._nodeModulePaths(path);
  return fakeModule;
}

/**
 * Normalize path to posix format.
 */

function normalizePath(fsPath) {
  fsPath = path.normalize(fsPath);

  if (process.platform === 'win32') {
    fsPath = fsPath.replace(backwardSlashRegExp, '/');
  }

  return fsPath;
}

/**
 * Forward the resolution to the next resolver (usually the native one)
 */

function callNativeResolution(request, issuer) {
  if (issuer.endsWith('/')) {
    issuer += 'internal.js';
  }

  try {
    enableNativeHooks = false;

    // Since we would need to create a fake module anyway (to call _resolveLookupPath that
    // would give us the paths to give to _resolveFilename), we can as well not use
    // the {paths} option at all, since it internally makes _resolveFilename create another
    // fake module anyway.
    return Module._resolveFilename(request, makeFakeModule(issuer), false);
  } finally {
    enableNativeHooks = true;
  }
}

/**
 * This key indicates which version of the standard is implemented by this resolver. The `std` key is the
 * Plug'n'Play standard, and any other key are third-party extensions. Third-party extensions are not allowed
 * to override the standard, and can only offer new methods.
 *
 * If an new version of the Plug'n'Play standard is released and some extensions conflict with newly added
 * functions, they'll just have to fix the conflicts and bump their own version number.
 */

exports.VERSIONS = {std: 1};

/**
 * Useful when used together with getPackageInformation to fetch information about the top-level package.
 */

exports.topLevel = {name: null, reference: null};

/**
 * Gets the package information for a given locator. Returns null if they cannot be retrieved.
 */

exports.getPackageInformation = function getPackageInformation({name, reference}) {
  const packageInformationStore = packageInformationStores.get(name);

  if (!packageInformationStore) {
    return null;
  }

  const packageInformation = packageInformationStore.get(reference);

  if (!packageInformation) {
    return null;
  }

  return packageInformation;
};

/**
 * Transforms a request (what's typically passed as argument to the require function) into an unqualified path.
 * This path is called "unqualified" because it only changes the package name to the package location on the disk,
 * which means that the end result still cannot be directly accessed (for example, it doesn't try to resolve the
 * file extension, or to resolve directories to their "index.js" content). Use the "resolveUnqualified" function
 * to convert them to fully-qualified paths, or just use "resolveRequest" that do both operations in one go.
 *
 * Note that it is extremely important that the `issuer` path ends with a forward slash if the issuer is to be
 * treated as a folder (ie. "/tmp/foo/" rather than "/tmp/foo" if "foo" is a directory). Otherwise relative
 * imports won't be computed correctly (they'll get resolved relative to "/tmp/" instead of "/tmp/foo/").
 */

exports.resolveToUnqualified = function resolveToUnqualified(request, issuer, {considerBuiltins = true} = {}) {
  // The 'pnpapi' request is reserved and will always return the path to the PnP file, from everywhere

  if (request === `pnpapi`) {
    return pnpFile;
  }

  // Bailout if the request is a native module

  if (considerBuiltins && builtinModules.has(request)) {
    return null;
  }

  // We allow disabling the pnp resolution for some subpaths. This is because some projects, often legacy,
  // contain multiple levels of dependencies (ie. a yarn.lock inside a subfolder of a yarn.lock). This is
  // typically solved using workspaces, but not all of them have been converted already.

  if (ignorePattern && ignorePattern.test(normalizePath(issuer))) {
    const result = callNativeResolution(request, issuer);

    if (result === false) {
      throw makeError(
        `BUILTIN_NODE_RESOLUTION_FAIL`,
        `The builtin node resolution algorithm was unable to resolve the module referenced by "${request}" and requested from "${issuer}" (it didn't go through the pnp resolver because the issuer was explicitely ignored by the regexp "null")`,
        {
          request,
          issuer,
        }
      );
    }

    return result;
  }

  let unqualifiedPath;

  // If the request is a relative or absolute path, we just return it normalized

  const dependencyNameMatch = request.match(pathRegExp);

  if (!dependencyNameMatch) {
    if (path.isAbsolute(request)) {
      unqualifiedPath = path.normalize(request);
    } else if (issuer.match(isDirRegExp)) {
      unqualifiedPath = path.normalize(path.resolve(issuer, request));
    } else {
      unqualifiedPath = path.normalize(path.resolve(path.dirname(issuer), request));
    }
  }

  // Things are more hairy if it's a package require - we then need to figure out which package is needed, and in
  // particular the exact version for the given location on the dependency tree

  if (dependencyNameMatch) {
    const [, dependencyName, subPath] = dependencyNameMatch;

    const issuerLocator = exports.findPackageLocator(issuer);

    // If the issuer file doesn't seem to be owned by a package managed through pnp, then we resort to using the next
    // resolution algorithm in the chain, usually the native Node resolution one

    if (!issuerLocator) {
      const result = callNativeResolution(request, issuer);

      if (result === false) {
        throw makeError(
          `BUILTIN_NODE_RESOLUTION_FAIL`,
          `The builtin node resolution algorithm was unable to resolve the module referenced by "${request}" and requested from "${issuer}" (it didn't go through the pnp resolver because the issuer doesn't seem to be part of the Yarn-managed dependency tree)`,
          {
            request,
            issuer,
          }
        );
      }

      return result;
    }

    const issuerInformation = getPackageInformationSafe(issuerLocator);

    // We obtain the dependency reference in regard to the package that request it

    let dependencyReference = issuerInformation.packageDependencies.get(dependencyName);

    // If we can't find it, we check if we can potentially load it from the packages that have been defined as potential fallbacks.
    // It's a bit of a hack, but it improves compatibility with the existing Node ecosystem. Hopefully we should eventually be able
    // to kill this logic and become stricter once pnp gets enough traction and the affected packages fix themselves.

    if (issuerLocator !== topLevelLocator) {
      for (let t = 0, T = fallbackLocators.length; dependencyReference === undefined && t < T; ++t) {
        const fallbackInformation = getPackageInformationSafe(fallbackLocators[t]);
        dependencyReference = fallbackInformation.packageDependencies.get(dependencyName);
      }
    }

    // If we can't find the path, and if the package making the request is the top-level, we can offer nicer error messages

    if (!dependencyReference) {
      if (dependencyReference === null) {
        if (issuerLocator === topLevelLocator) {
          throw makeError(
            `MISSING_PEER_DEPENDENCY`,
            `You seem to be requiring a peer dependency ("${dependencyName}"), but it is not installed (which might be because you're the top-level package)`,
            {request, issuer, dependencyName}
          );
        } else {
          throw makeError(
            `MISSING_PEER_DEPENDENCY`,
            `Package "${issuerLocator.name}@${issuerLocator.reference}" is trying to access a peer dependency ("${dependencyName}") that should be provided by its direct ancestor but isn't`,
            {request, issuer, issuerLocator: Object.assign({}, issuerLocator), dependencyName}
          );
        }
      } else {
        if (issuerLocator === topLevelLocator) {
          throw makeError(
            `UNDECLARED_DEPENDENCY`,
            `You cannot require a package ("${dependencyName}") that is not declared in your dependencies (via "${issuer}")`,
            {request, issuer, dependencyName}
          );
        } else {
          const candidates = Array.from(issuerInformation.packageDependencies.keys());
          throw makeError(
            `UNDECLARED_DEPENDENCY`,
            `Package "${issuerLocator.name}@${issuerLocator.reference}" (via "${issuer}") is trying to require the package "${dependencyName}" (via "${request}") without it being listed in its dependencies (${candidates.join(
              `, `
            )})`,
            {request, issuer, issuerLocator: Object.assign({}, issuerLocator), dependencyName, candidates}
          );
        }
      }
    }

    // We need to check that the package exists on the filesystem, because it might not have been installed

    const dependencyLocator = {name: dependencyName, reference: dependencyReference};
    const dependencyInformation = exports.getPackageInformation(dependencyLocator);
    const dependencyLocation = path.resolve(__dirname, dependencyInformation.packageLocation);

    if (!dependencyLocation) {
      throw makeError(
        `MISSING_DEPENDENCY`,
        `Package "${dependencyLocator.name}@${dependencyLocator.reference}" is a valid dependency, but hasn't been installed and thus cannot be required (it might be caused if you install a partial tree, such as on production environments)`,
        {request, issuer, dependencyLocator: Object.assign({}, dependencyLocator)}
      );
    }

    // Now that we know which package we should resolve to, we only have to find out the file location

    if (subPath) {
      unqualifiedPath = path.resolve(dependencyLocation, subPath);
    } else {
      unqualifiedPath = dependencyLocation;
    }
  }

  return path.normalize(unqualifiedPath);
};

/**
 * Transforms an unqualified path into a qualified path by using the Node resolution algorithm (which automatically
 * appends ".js" / ".json", and transforms directory accesses into "index.js").
 */

exports.resolveUnqualified = function resolveUnqualified(
  unqualifiedPath,
  {extensions = Object.keys(Module._extensions)} = {}
) {
  const qualifiedPath = applyNodeExtensionResolution(unqualifiedPath, {extensions});

  if (qualifiedPath) {
    return path.normalize(qualifiedPath);
  } else {
    throw makeError(
      `QUALIFIED_PATH_RESOLUTION_FAILED`,
      `Couldn't find a suitable Node resolution for unqualified path "${unqualifiedPath}"`,
      {unqualifiedPath}
    );
  }
};

/**
 * Transforms a request into a fully qualified path.
 *
 * Note that it is extremely important that the `issuer` path ends with a forward slash if the issuer is to be
 * treated as a folder (ie. "/tmp/foo/" rather than "/tmp/foo" if "foo" is a directory). Otherwise relative
 * imports won't be computed correctly (they'll get resolved relative to "/tmp/" instead of "/tmp/foo/").
 */

exports.resolveRequest = function resolveRequest(request, issuer, {considerBuiltins, extensions} = {}) {
  let unqualifiedPath;

  try {
    unqualifiedPath = exports.resolveToUnqualified(request, issuer, {considerBuiltins});
  } catch (originalError) {
    // If we get a BUILTIN_NODE_RESOLUTION_FAIL error there, it means that we've had to use the builtin node
    // resolution, which usually shouldn't happen. It might be because the user is trying to require something
    // from a path loaded through a symlink (which is not possible, because we need something normalized to
    // figure out which package is making the require call), so we try to make the same request using a fully
    // resolved issuer and throws a better and more actionable error if it works.
    if (originalError.code === `BUILTIN_NODE_RESOLUTION_FAIL`) {
      let realIssuer;

      try {
        realIssuer = realpathSync(issuer);
      } catch (error) {}

      if (realIssuer) {
        if (issuer.endsWith(`/`)) {
          realIssuer = realIssuer.replace(/\/?$/, `/`);
        }

        try {
          exports.resolveToUnqualified(request, realIssuer, {considerBuiltins});
        } catch (error) {
          // If an error was thrown, the problem doesn't seem to come from a path not being normalized, so we
          // can just throw the original error which was legit.
          throw originalError;
        }

        // If we reach this stage, it means that resolveToUnqualified didn't fail when using the fully resolved
        // file path, which is very likely caused by a module being invoked through Node with a path not being
        // correctly normalized (ie you should use "node $(realpath script.js)" instead of "node script.js").
        throw makeError(
          `SYMLINKED_PATH_DETECTED`,
          `A pnp module ("${request}") has been required from what seems to be a symlinked path ("${issuer}"). This is not possible, you must ensure that your modules are invoked through their fully resolved path on the filesystem (in this case "${realIssuer}").`,
          {
            request,
            issuer,
            realIssuer,
          }
        );
      }
    }
    throw originalError;
  }

  if (unqualifiedPath === null) {
    return null;
  }

  try {
    return exports.resolveUnqualified(unqualifiedPath, {extensions});
  } catch (resolutionError) {
    if (resolutionError.code === 'QUALIFIED_PATH_RESOLUTION_FAILED') {
      Object.assign(resolutionError.data, {request, issuer});
    }
    throw resolutionError;
  }
};

/**
 * Setups the hook into the Node environment.
 *
 * From this point on, any call to `require()` will go through the "resolveRequest" function, and the result will
 * be used as path of the file to load.
 */

exports.setup = function setup() {
  // A small note: we don't replace the cache here (and instead use the native one). This is an effort to not
  // break code similar to "delete require.cache[require.resolve(FOO)]", where FOO is a package located outside
  // of the Yarn dependency tree. In this case, we defer the load to the native loader. If we were to replace the
  // cache by our own, the native loader would populate its own cache, which wouldn't be exposed anymore, so the
  // delete call would be broken.

  const originalModuleLoad = Module._load;

  Module._load = function(request, parent, isMain) {
    if (!enableNativeHooks) {
      return originalModuleLoad.call(Module, request, parent, isMain);
    }

    // Builtins are managed by the regular Node loader

    if (builtinModules.has(request)) {
      try {
        enableNativeHooks = false;
        return originalModuleLoad.call(Module, request, parent, isMain);
      } finally {
        enableNativeHooks = true;
      }
    }

    // The 'pnpapi' name is reserved to return the PnP api currently in use by the program

    if (request === `pnpapi`) {
      return pnpModule.exports;
    }

    // Request `Module._resolveFilename` (ie. `resolveRequest`) to tell us which file we should load

    const modulePath = Module._resolveFilename(request, parent, isMain);

    // Check if the module has already been created for the given file

    const cacheEntry = Module._cache[modulePath];

    if (cacheEntry) {
      return cacheEntry.exports;
    }

    // Create a new module and store it into the cache

    const module = new Module(modulePath, parent);
    Module._cache[modulePath] = module;

    // The main module is exposed as global variable

    if (isMain) {
      process.mainModule = module;
      module.id = '.';
    }

    // Try to load the module, and remove it from the cache if it fails

    let hasThrown = true;

    try {
      module.load(modulePath);
      hasThrown = false;
    } finally {
      if (hasThrown) {
        delete Module._cache[modulePath];
      }
    }

    // Some modules might have to be patched for compatibility purposes

    for (const [filter, patchFn] of patchedModules) {
      if (filter.test(request)) {
        module.exports = patchFn(exports.findPackageLocator(parent.filename), module.exports);
      }
    }

    return module.exports;
  };

  const originalModuleResolveFilename = Module._resolveFilename;

  Module._resolveFilename = function(request, parent, isMain, options) {
    if (!enableNativeHooks) {
      return originalModuleResolveFilename.call(Module, request, parent, isMain, options);
    }

    let issuers;

    if (options) {
      const optionNames = new Set(Object.keys(options));
      optionNames.delete('paths');

      if (optionNames.size > 0) {
        throw makeError(
          `UNSUPPORTED`,
          `Some options passed to require() aren't supported by PnP yet (${Array.from(optionNames).join(', ')})`
        );
      }

      if (options.paths) {
        issuers = options.paths.map(entry => `${path.normalize(entry)}/`);
      }
    }

    if (!issuers) {
      const issuerModule = getIssuerModule(parent);
      const issuer = issuerModule ? issuerModule.filename : `${process.cwd()}/`;

      issuers = [issuer];
    }

    let firstError;

    for (const issuer of issuers) {
      let resolution;

      try {
        resolution = exports.resolveRequest(request, issuer);
      } catch (error) {
        firstError = firstError || error;
        continue;
      }

      return resolution !== null ? resolution : request;
    }

    throw firstError;
  };

  const originalFindPath = Module._findPath;

  Module._findPath = function(request, paths, isMain) {
    if (!enableNativeHooks) {
      return originalFindPath.call(Module, request, paths, isMain);
    }

    for (const path of paths || []) {
      let resolution;

      try {
        resolution = exports.resolveRequest(request, path);
      } catch (error) {
        continue;
      }

      if (resolution) {
        return resolution;
      }
    }

    return false;
  };

  process.versions.pnp = String(exports.VERSIONS.std);
};

exports.setupCompatibilityLayer = () => {
  // ESLint currently doesn't have any portable way for shared configs to specify their own
  // plugins that should be used (https://github.com/eslint/eslint/issues/10125). This will
  // likely get fixed at some point, but it'll take time and in the meantime we'll just add
  // additional fallback entries for common shared configs.

  for (const name of [`react-scripts`]) {
    const packageInformationStore = packageInformationStores.get(name);
    if (packageInformationStore) {
      for (const reference of packageInformationStore.keys()) {
        fallbackLocators.push({name, reference});
      }
    }
  }

  // Modern versions of `resolve` support a specific entry point that custom resolvers can use
  // to inject a specific resolution logic without having to patch the whole package.
  //
  // Cf: https://github.com/browserify/resolve/pull/174

  patchedModules.push([
    /^\.\/normalize-options\.js$/,
    (issuer, normalizeOptions) => {
      if (!issuer || issuer.name !== 'resolve') {
        return normalizeOptions;
      }

      return (request, opts) => {
        opts = opts || {};

        if (opts.forceNodeResolution) {
          return opts;
        }

        opts.preserveSymlinks = true;
        opts.paths = function(request, basedir, getNodeModulesDir, opts) {
          // Extract the name of the package being requested (1=full name, 2=scope name, 3=local name)
          const parts = request.match(/^((?:(@[^\/]+)\/)?([^\/]+))/);

          // make sure that basedir ends with a slash
          if (basedir.charAt(basedir.length - 1) !== '/') {
            basedir = path.join(basedir, '/');
          }
          // This is guaranteed to return the path to the "package.json" file from the given package
          const manifestPath = exports.resolveToUnqualified(`${parts[1]}/package.json`, basedir);

          // The first dirname strips the package.json, the second strips the local named folder
          let nodeModules = path.dirname(path.dirname(manifestPath));

          // Strips the scope named folder if needed
          if (parts[2]) {
            nodeModules = path.dirname(nodeModules);
          }

          return [nodeModules];
        };

        return opts;
      };
    },
  ]);
};

if (module.parent && module.parent.id === 'internal/preload') {
  exports.setupCompatibilityLayer();

  exports.setup();
}

if (process.mainModule === module) {
  exports.setupCompatibilityLayer();

  const reportError = (code, message, data) => {
    process.stdout.write(`${JSON.stringify([{code, message, data}, null])}\n`);
  };

  const reportSuccess = resolution => {
    process.stdout.write(`${JSON.stringify([null, resolution])}\n`);
  };

  const processResolution = (request, issuer) => {
    try {
      reportSuccess(exports.resolveRequest(request, issuer));
    } catch (error) {
      reportError(error.code, error.message, error.data);
    }
  };

  const processRequest = data => {
    try {
      const [request, issuer] = JSON.parse(data);
      processResolution(request, issuer);
    } catch (error) {
      reportError(`INVALID_JSON`, error.message, error.data);
    }
  };

  if (process.argv.length > 2) {
    if (process.argv.length !== 4) {
      process.stderr.write(`Usage: ${process.argv[0]} ${process.argv[1]} <request> <issuer>\n`);
      process.exitCode = 64; /* EX_USAGE */
    } else {
      processResolution(process.argv[2], process.argv[3]);
    }
  } else {
    let buffer = '';
    const decoder = new StringDecoder.StringDecoder();

    process.stdin.on('data', chunk => {
      buffer += decoder.write(chunk);

      do {
        const index = buffer.indexOf('\n');
        if (index === -1) {
          break;
        }

        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);

        processRequest(line);
      } while (true);
    });
  }
       }
