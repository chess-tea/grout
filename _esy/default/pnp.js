#!/usr/bin/env node
/* eslint-disable max-len, flowtype/require-valid-file-annotation, flowtype/require-return-type */
/* global packageInformationStores, $$BLACKLIST, $$SETUP_STATIC_TABLES */

// Used for the resolveUnqualified part of the resolution (ie resolving folder/index.js & file extensions)
// Deconstructed so that they aren't affected by any fs monkeypatching occuring later during the execution
const {statSync, lstatSync, readlinkSync, readFileSync, existsSync, realpathSync} = require('fs');

const Module = require('module');
const path = require('path');
const StringDecoder = require('string_decoder');

const $$BLACKLIST = null;
const ignorePattern = $$BLACKLIST ? new RegExp($$BLACKLIST) : null;

const builtinModules = new Set(Module.builtinModules || Object.keys(process.binding('natives')));

const topLevelLocator = {name: null, reference: null};
const blacklistedLocator = {name: NaN, reference: NaN};

// Used for compatibility purposes - cf setupCompatibilityLayer
const patchedModules = new Map();
const fallbackLocators = [topLevelLocator];

// Matches backslashes of Windows paths
const backwardSlashRegExp = /\\/g;

// Matches if the path must point to a directory (ie ends with /)
const isDirRegExp = /\/$/;

// Matches if the path starts with a valid path qualifier (./, ../, /)
// eslint-disable-next-line no-unused-vars
const isStrictRegExp = /^\.{0,2}/;

// Splits a require request into its components, or return null if the request is a file path
const pathRegExp = /^(?![A-Za-z]:)(?!\.{0,2}(?:\/|$))((?:@[^\/]+\/)?[^\/]+)\/?(.*|)$/;

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
      ].join(` `),
    );
  }

  return locator;
}

let packageInformationStores = new Map([
["@brisk/brisk-reconciler",
new Map([["github:briskml/brisk-reconciler#0a2e476",
         {
           packageLocation: "/Users/kad/.esy/source/i/brisk__s__brisk_reconciler__32ca6d03/",
           packageDependencies: new Map([["@brisk/brisk-reconciler",
                                         "github:briskml/brisk-reconciler#0a2e476"],
                                           ["@esy-ocaml/reason", "3.5.2"],
                                           ["@opam/dune", "opam:1.11.4"],
                                           ["@opam/ppxlib", "opam:0.8.1"],
                                           ["ocaml", "4.8.1000"]])}]])],
  ["@esy-cross/ninja-build",
  new Map([["1.8.2001",
           {
             packageLocation: "/Users/kad/.esy/source/i/esy_cross__s__ninja_build__1.8.2001__fbfd8054/",
             packageDependencies: new Map([["@esy-cross/ninja-build",
                                           "1.8.2001"]])}]])],
  ["@esy-ocaml/libffi",
  new Map([["github:esy-ocaml/libffi#c61127d",
           {
             packageLocation: "/Users/kad/.esy/source/i/esy_ocaml__s__libffi__4f2caedb/",
             packageDependencies: new Map([["@esy-ocaml/libffi",
                                           "github:esy-ocaml/libffi#c61127d"]])}]])],
  ["@esy-ocaml/reason",
  new Map([["3.5.2",
           {
             packageLocation: "/Users/kad/.esy/source/i/esy_ocaml__s__reason__3.5.2__98a6da55/",
             packageDependencies: new Map([["@esy-ocaml/reason", "3.5.2"],
                                             ["@opam/dune", "opam:1.11.4"],
                                             ["@opam/menhir",
                                             "opam:20190924"],
                                             ["@opam/merlin-extend",
                                             "opam:0.5"],
                                             ["@opam/ocaml-migrate-parsetree",
                                             "opam:1.5.0"],
                                             ["@opam/ocamlfind",
                                             "opam:1.8.1"],
                                             ["@opam/result", "opam:1.4"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@esy-ocaml/substs",
  new Map([["0.0.1",
           {
             packageLocation: "/Users/kad/.esy/source/i/esy_ocaml__s__substs__0.0.1__19de1ee1/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"]])}]])],
  ["@opam/astring",
  new Map([["opam:0.8.3",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__astring__opam__c__0.8.3__3d7df80e/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/astring", "opam:0.8.3"],
                                             ["@opam/base-bytes",
                                             "opam:base"],
                                             ["@opam/ocamlbuild",
                                             "opam:0.14.0"],
                                             ["@opam/ocamlfind",
                                             "opam:1.8.1"],
                                             ["@opam/topkg", "opam:1.0.1"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@opam/atd",
  new Map([["opam:2.0.0",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__atd__opam__c__2.0.0__b632d97c/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/atd", "opam:2.0.0"],
                                             ["@opam/easy-format",
                                             "opam:1.3.2"],
                                             ["@opam/jbuilder",
                                             "opam:transition"],
                                             ["@opam/menhir",
                                             "opam:20190924"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@opam/atdgen",
  new Map([["opam:2.0.0",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__atdgen__opam__c__2.0.0__ce54a24a/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/atd", "opam:2.0.0"],
                                             ["@opam/atdgen", "opam:2.0.0"],
                                             ["@opam/atdgen-runtime",
                                             "opam:2.0.0"],
                                             ["@opam/biniou", "opam:1.2.1"],
                                             ["@opam/jbuilder",
                                             "opam:transition"],
                                             ["@opam/yojson", "opam:1.7.0"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@opam/atdgen-runtime",
  new Map([["opam:2.0.0",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__atdgen_runtime__opam__c__2.0.0__2d033876/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/atdgen-runtime",
                                             "opam:2.0.0"],
                                             ["@opam/biniou", "opam:1.2.1"],
                                             ["@opam/jbuilder",
                                             "opam:transition"],
                                             ["@opam/yojson", "opam:1.7.0"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@opam/base",
  new Map([["opam:v0.13.1",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__base__opam__c__v0.13.1__8883050b/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.13.1"],
                                             ["@opam/dune", "opam:1.11.4"],
                                             ["@opam/dune-configurator",
                                             "opam:1.0.0"],
                                             ["@opam/sexplib0",
                                             "opam:v0.13.0"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@opam/base-bytes",
  new Map([["opam:base",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__base_bytes__opam__c__base__48b6019a/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base-bytes",
                                             "opam:base"],
                                             ["@opam/ocamlfind",
                                             "opam:1.8.1"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@opam/base-threads",
  new Map([["opam:base",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__base_threads__opam__c__base__f282958b/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base-threads",
                                             "opam:base"]])}]])],
  ["@opam/base-unix",
  new Map([["opam:base",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__base_unix__opam__c__base__93427a57/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base-unix", "opam:base"]])}]])],
  ["@opam/biniou",
  new Map([["opam:1.2.1",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__biniou__opam__c__1.2.1__b33b4deb/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/biniou", "opam:1.2.1"],
                                             ["@opam/dune", "opam:1.11.4"],
                                             ["@opam/easy-format",
                                             "opam:1.3.2"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@opam/camomile",
  new Map([["opam:1.0.2",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__camomile__opam__c__1.0.2__f183008c/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/camomile", "opam:1.0.2"],
                                             ["@opam/dune", "opam:1.11.4"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@opam/charInfo_width",
  new Map([["opam:1.1.0",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__charinfo__width__opam__c__1.1.0__83f68528/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/camomile", "opam:1.0.2"],
                                             ["@opam/charInfo_width",
                                             "opam:1.1.0"],
                                             ["@opam/dune", "opam:1.11.4"],
                                             ["@opam/result", "opam:1.4"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@opam/cmdliner",
  new Map([["opam:1.0.2",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__cmdliner__opam__c__1.0.2__22a2267f/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/cmdliner", "opam:1.0.2"],
                                             ["@opam/ocamlbuild",
                                             "opam:0.14.0"],
                                             ["@opam/ocamlfind",
                                             "opam:1.8.1"],
                                             ["@opam/result", "opam:1.4"],
                                             ["@opam/topkg", "opam:1.0.1"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@opam/conf-m4",
  new Map([["opam:1",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__conf_m4__opam__c__1__7031fb84/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/conf-m4", "opam:1"]])}]])],
  ["@opam/conf-pkg-config",
  new Map([["opam:1.1",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__conf_pkg_config__opam__c__1.1__79849a14/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/conf-pkg-config",
                                             "opam:1.1"],
                                             ["yarn-pkg-config",
                                             "github:esy-ocaml/yarn-pkg-config#cca65f99674ed2d954d28788edeb8c57fada5ed0"]])}]])],
  ["@opam/cppo",
  new Map([["opam:1.6.6",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__cppo__opam__c__1.6.6__df887bb2/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base-unix", "opam:base"],
                                             ["@opam/cppo", "opam:1.6.6"],
                                             ["@opam/dune", "opam:1.11.4"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@opam/ctypes",
  new Map([["opam:0.15.1",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__ctypes__opam__c__0.15.1__1a0a3b62/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base-bytes",
                                             "opam:base"],
                                             ["@opam/conf-pkg-config",
                                             "opam:1.1"],
                                             ["@opam/ctypes", "opam:0.15.1"],
                                             ["@opam/ctypes-foreign",
                                             "opam:0.4.0"],
                                             ["@opam/integers", "opam:0.3.0"],
                                             ["@opam/ocamlfind",
                                             "opam:1.8.1"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@opam/ctypes-foreign",
  new Map([["opam:0.4.0",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__ctypes_foreign__opam__c__0.4.0__8e21d25d/",
             packageDependencies: new Map([["@esy-ocaml/libffi",
                                           "github:esy-ocaml/libffi#c61127d"],
                                             ["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/ctypes-foreign",
                                             "opam:0.4.0"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@opam/dune",
  new Map([["opam:1.11.4",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__dune__opam__c__1.11.4__7815d6f1/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base-threads",
                                             "opam:base"],
                                             ["@opam/base-unix", "opam:base"],
                                             ["@opam/dune", "opam:1.11.4"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@opam/dune-configurator",
  new Map([["opam:1.0.0",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__dune_configurator__opam__c__1.0.0__1ed35223/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:1.11.4"],
                                             ["@opam/dune-configurator",
                                             "opam:1.0.0"]])}]])],
  ["@opam/easy-format",
  new Map([["opam:1.3.2",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__easy_format__opam__c__1.3.2__f5ebc92b/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:1.11.4"],
                                             ["@opam/easy-format",
                                             "opam:1.3.2"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@opam/fmt",
  new Map([["opam:0.8.8",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__fmt__opam__c__0.8.8__81d71639/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base-unix", "opam:base"],
                                             ["@opam/cmdliner", "opam:1.0.2"],
                                             ["@opam/fmt", "opam:0.8.8"],
                                             ["@opam/ocamlbuild",
                                             "opam:0.14.0"],
                                             ["@opam/ocamlfind",
                                             "opam:1.8.1"],
                                             ["@opam/seq", "opam:base"],
                                             ["@opam/stdlib-shims",
                                             "opam:0.1.0"],
                                             ["@opam/topkg", "opam:1.0.1"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@opam/fpath",
  new Map([["opam:0.7.2",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__fpath__opam__c__0.7.2__d7c490cc/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/astring", "opam:0.8.3"],
                                             ["@opam/fpath", "opam:0.7.2"],
                                             ["@opam/ocamlbuild",
                                             "opam:0.14.0"],
                                             ["@opam/ocamlfind",
                                             "opam:1.8.1"],
                                             ["@opam/result", "opam:1.4"],
                                             ["@opam/topkg", "opam:1.0.1"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@opam/integers",
  new Map([["opam:0.3.0",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__integers__opam__c__0.3.0__ed48b907/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:1.11.4"],
                                             ["@opam/integers", "opam:0.3.0"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@opam/jbuilder",
  new Map([["opam:transition",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__jbuilder__opam__c__transition__90401214/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:1.11.4"],
                                             ["@opam/jbuilder",
                                             "opam:transition"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@opam/js_of_ocaml",
  new Map([["opam:3.5.2",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__js__of__ocaml__opam__c__3.5.2__6628a9fa/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:1.11.4"],
                                             ["@opam/js_of_ocaml",
                                             "opam:3.5.2"],
                                             ["@opam/js_of_ocaml-compiler",
                                             "opam:3.5.0"],
                                             ["@opam/ocaml-migrate-parsetree",
                                             "opam:1.5.0"],
                                             ["@opam/ppx_tools_versioned",
                                             "opam:5.2.3"],
                                             ["@opam/uchar", "opam:0.0.2"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@opam/js_of_ocaml-compiler",
  new Map([["opam:3.5.0",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__js__of__ocaml_compiler__opam__c__3.5.0__5e3f9041/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/cmdliner", "opam:1.0.2"],
                                             ["@opam/dune", "opam:1.11.4"],
                                             ["@opam/js_of_ocaml-compiler",
                                             "opam:3.5.0"],
                                             ["@opam/ocaml-migrate-parsetree",
                                             "opam:1.5.0"],
                                             ["@opam/ocamlfind",
                                             "opam:1.8.1"],
                                             ["@opam/yojson", "opam:1.7.0"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@opam/js_of_ocaml-lwt",
  new Map([["opam:3.5.2",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__js__of__ocaml_lwt__opam__c__3.5.2__f928b194/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:1.11.4"],
                                             ["@opam/js_of_ocaml",
                                             "opam:3.5.2"],
                                             ["@opam/js_of_ocaml-lwt",
                                             "opam:3.5.2"],
                                             ["@opam/js_of_ocaml-ppx",
                                             "opam:3.5.2"],
                                             ["@opam/lwt", "opam:4.5.0"],
                                             ["@opam/lwt_log", "opam:1.1.1"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@opam/js_of_ocaml-ppx",
  new Map([["opam:3.5.2",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__js__of__ocaml_ppx__opam__c__3.5.2__62a8f60b/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:1.11.4"],
                                             ["@opam/js_of_ocaml",
                                             "opam:3.5.2"],
                                             ["@opam/js_of_ocaml-ppx",
                                             "opam:3.5.2"],
                                             ["@opam/ocaml-migrate-parsetree",
                                             "opam:1.5.0"],
                                             ["@opam/ppx_tools_versioned",
                                             "opam:5.2.3"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@opam/junit",
  new Map([["opam:2.0.2",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__junit__opam__c__2.0.2__380d7b58/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:1.11.4"],
                                             ["@opam/junit", "opam:2.0.2"],
                                             ["@opam/ptime", "opam:0.8.5"],
                                             ["@opam/tyxml", "opam:4.3.0"]])}]])],
  ["@opam/lambda-term",
  new Map([["opam:2.0.3",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__lambda_term__opam__c__2.0.3__cf7cddb3/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/camomile", "opam:1.0.2"],
                                             ["@opam/dune", "opam:1.11.4"],
                                             ["@opam/lambda-term",
                                             "opam:2.0.3"],
                                             ["@opam/lwt", "opam:4.5.0"],
                                             ["@opam/lwt_log", "opam:1.1.1"],
                                             ["@opam/lwt_react",
                                             "opam:1.1.3"],
                                             ["@opam/react", "opam:1.2.1"],
                                             ["@opam/zed", "opam:2.0.5"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@opam/logs",
  new Map([["opam:0.7.0",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__logs__opam__c__0.7.0__cf15da05/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base-threads",
                                             "opam:base"],
                                             ["@opam/cmdliner", "opam:1.0.2"],
                                             ["@opam/fmt", "opam:0.8.8"],
                                             ["@opam/js_of_ocaml",
                                             "opam:3.5.2"],
                                             ["@opam/logs", "opam:0.7.0"],
                                             ["@opam/lwt", "opam:4.5.0"],
                                             ["@opam/ocamlbuild",
                                             "opam:0.14.0"],
                                             ["@opam/ocamlfind",
                                             "opam:1.8.1"],
                                             ["@opam/topkg", "opam:1.0.1"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@opam/lwt",
  new Map([["opam:4.5.0",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__lwt__opam__c__4.5.0__2c50b34d/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base-threads",
                                             "opam:base"],
                                             ["@opam/base-unix", "opam:base"],
                                             ["@opam/cppo", "opam:1.6.6"],
                                             ["@opam/dune", "opam:1.11.4"],
                                             ["@opam/dune-configurator",
                                             "opam:1.0.0"],
                                             ["@opam/lwt", "opam:4.5.0"],
                                             ["@opam/mmap", "opam:1.1.0"],
                                             ["@opam/ocplib-endian",
                                             "opam:1.0"],
                                             ["@opam/result", "opam:1.4"],
                                             ["@opam/seq", "opam:base"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@opam/lwt_log",
  new Map([["opam:1.1.1",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__lwt__log__opam__c__1.1.1__0a48d385/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:1.11.4"],
                                             ["@opam/lwt", "opam:4.5.0"],
                                             ["@opam/lwt_log", "opam:1.1.1"]])}]])],
  ["@opam/lwt_ppx",
  new Map([["opam:2.0.0",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__lwt__ppx__opam__c__2.0.0__cd63864d/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:1.11.4"],
                                             ["@opam/lwt", "opam:4.5.0"],
                                             ["@opam/lwt_ppx", "opam:2.0.0"],
                                             ["@opam/ocaml-migrate-parsetree",
                                             "opam:1.5.0"],
                                             ["@opam/ppx_tools_versioned",
                                             "opam:5.2.3"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@opam/lwt_react",
  new Map([["opam:1.1.3",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__lwt__react__opam__c__1.1.3__86443f3c/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:1.11.4"],
                                             ["@opam/lwt", "opam:4.5.0"],
                                             ["@opam/lwt_react",
                                             "opam:1.1.3"],
                                             ["@opam/react", "opam:1.2.1"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@opam/menhir",
  new Map([["opam:20190924",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__menhir__opam__c__20190924__cffc2327/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/menhir",
                                             "opam:20190924"],
                                             ["@opam/ocamlbuild",
                                             "opam:0.14.0"],
                                             ["@opam/ocamlfind",
                                             "opam:1.8.1"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@opam/merlin",
  new Map([["opam:3.3.3",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__merlin__opam__c__3.3.3__4f09323c/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:1.11.4"],
                                             ["@opam/merlin", "opam:3.3.3"],
                                             ["@opam/ocamlfind",
                                             "opam:1.8.1"],
                                             ["@opam/yojson", "opam:1.7.0"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@opam/merlin-extend",
  new Map([["opam:0.5",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__merlin_extend__opam__c__0.5__d71a3621/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/cppo", "opam:1.6.6"],
                                             ["@opam/dune", "opam:1.11.4"],
                                             ["@opam/merlin-extend",
                                             "opam:0.5"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@opam/mmap",
  new Map([["opam:1.1.0",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__mmap__opam__c__1.1.0__2cba59f8/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:1.11.4"],
                                             ["@opam/mmap", "opam:1.1.0"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@opam/ocaml-compiler-libs",
  new Map([["opam:v0.12.1",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__ocaml_compiler_libs__opam__c__v0.12.1__b59f5bd2/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:1.11.4"],
                                             ["@opam/ocaml-compiler-libs",
                                             "opam:v0.12.1"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@opam/ocaml-migrate-parsetree",
  new Map([["opam:1.5.0",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__ocaml_migrate_parsetree__opam__c__1.5.0__ef212ce2/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:1.11.4"],
                                             ["@opam/ocaml-migrate-parsetree",
                                             "opam:1.5.0"],
                                             ["@opam/ppx_derivers",
                                             "opam:1.2.1"],
                                             ["@opam/result", "opam:1.4"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@opam/ocamlbuild",
  new Map([["opam:0.14.0",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__ocamlbuild__opam__c__0.14.0__aff6a0b0/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/ocamlbuild",
                                             "opam:0.14.0"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@opam/ocamlfind",
  new Map([["opam:1.8.1",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__ocamlfind__opam__c__1.8.1__0bdaf9d3/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/conf-m4", "opam:1"],
                                             ["@opam/ocamlfind",
                                             "opam:1.8.1"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@opam/ocplib-endian",
  new Map([["opam:1.0",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__ocplib_endian__opam__c__1.0__aceff5fc/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base-bytes",
                                             "opam:base"],
                                             ["@opam/cppo", "opam:1.6.6"],
                                             ["@opam/ocamlbuild",
                                             "opam:0.14.0"],
                                             ["@opam/ocamlfind",
                                             "opam:1.8.1"],
                                             ["@opam/ocplib-endian",
                                             "opam:1.0"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@opam/ppx_derivers",
  new Map([["opam:1.2.1",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__ppx__derivers__opam__c__1.2.1__a5e0f03f/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:1.11.4"],
                                             ["@opam/ppx_derivers",
                                             "opam:1.2.1"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@opam/ppx_deriving",
  new Map([["opam:4.4.1",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__ppx__deriving__opam__c__4.4.1__5b015f9c/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/cppo", "opam:1.6.6"],
                                             ["@opam/dune", "opam:1.11.4"],
                                             ["@opam/ocaml-migrate-parsetree",
                                             "opam:1.5.0"],
                                             ["@opam/ppx_derivers",
                                             "opam:1.2.1"],
                                             ["@opam/ppx_deriving",
                                             "opam:4.4.1"],
                                             ["@opam/ppx_tools",
                                             "opam:6.0+4.08.0"],
                                             ["@opam/ppxfind", "opam:1.3"],
                                             ["@opam/result", "opam:1.4"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@opam/ppx_tools",
  new Map([["opam:6.0+4.08.0",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__ppx__tools__opam__c__6.0+4.08.0__763e17b8/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:1.11.4"],
                                             ["@opam/ppx_tools",
                                             "opam:6.0+4.08.0"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@opam/ppx_tools_versioned",
  new Map([["opam:5.2.3",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__ppx__tools__versioned__opam__c__5.2.3__18f062da/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:1.11.4"],
                                             ["@opam/ocaml-migrate-parsetree",
                                             "opam:1.5.0"],
                                             ["@opam/ppx_tools_versioned",
                                             "opam:5.2.3"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@opam/ppxfind",
  new Map([["opam:1.3",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__ppxfind__opam__c__1.3__6eea3af9/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:1.11.4"],
                                             ["@opam/ocaml-migrate-parsetree",
                                             "opam:1.5.0"],
                                             ["@opam/ocamlfind",
                                             "opam:1.8.1"],
                                             ["@opam/ppxfind", "opam:1.3"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@opam/ppxlib",
  new Map([["opam:0.8.1",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__ppxlib__opam__c__0.8.1__d9f90443/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.13.1"],
                                             ["@opam/dune", "opam:1.11.4"],
                                             ["@opam/ocaml-compiler-libs",
                                             "opam:v0.12.1"],
                                             ["@opam/ocaml-migrate-parsetree",
                                             "opam:1.5.0"],
                                             ["@opam/ppx_derivers",
                                             "opam:1.2.1"],
                                             ["@opam/ppxlib", "opam:0.8.1"],
                                             ["@opam/stdio", "opam:v0.13.0"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@opam/printbox",
  new Map([["opam:0.4",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__printbox__opam__c__0.4__072574b0/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base-bytes",
                                             "opam:base"],
                                             ["@opam/dune", "opam:1.11.4"],
                                             ["@opam/printbox", "opam:0.4"],
                                             ["@opam/tyxml", "opam:4.3.0"],
                                             ["@opam/uutf", "opam:1.0.2"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@opam/ptime",
  new Map([["opam:0.8.5",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__ptime__opam__c__0.8.5__79d19c69/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/js_of_ocaml",
                                             "opam:3.5.2"],
                                             ["@opam/ocamlbuild",
                                             "opam:0.14.0"],
                                             ["@opam/ocamlfind",
                                             "opam:1.8.1"],
                                             ["@opam/ptime", "opam:0.8.5"],
                                             ["@opam/result", "opam:1.4"],
                                             ["@opam/topkg", "opam:1.0.1"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@opam/re",
  new Map([["opam:1.9.0",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__re__opam__c__1.9.0__0f723101/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:1.11.4"],
                                             ["@opam/re", "opam:1.9.0"],
                                             ["@opam/seq", "opam:base"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@opam/react",
  new Map([["opam:1.2.1",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__react__opam__c__1.2.1__3f366b0c/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/ocamlbuild",
                                             "opam:0.14.0"],
                                             ["@opam/ocamlfind",
                                             "opam:1.8.1"],
                                             ["@opam/react", "opam:1.2.1"],
                                             ["@opam/topkg", "opam:1.0.1"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@opam/result",
  new Map([["opam:1.4",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__result__opam__c__1.4__51db07da/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:1.11.4"],
                                             ["@opam/result", "opam:1.4"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@opam/seq",
  new Map([["opam:base",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__seq__opam__c__base__a0c677b1/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/seq", "opam:base"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@opam/sexplib0",
  new Map([["opam:v0.13.0",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__sexplib0__opam__c__v0.13.0__7f6e9078/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:1.11.4"],
                                             ["@opam/sexplib0",
                                             "opam:v0.13.0"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@opam/stdio",
  new Map([["opam:v0.13.0",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__stdio__opam__c__v0.13.0__d7d39043/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base", "opam:v0.13.1"],
                                             ["@opam/dune", "opam:1.11.4"],
                                             ["@opam/stdio", "opam:v0.13.0"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@opam/stdlib-shims",
  new Map([["opam:0.1.0",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__stdlib_shims__opam__c__0.1.0__0eb3c4d9/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:1.11.4"],
                                             ["@opam/stdlib-shims",
                                             "opam:0.1.0"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@opam/topkg",
  new Map([["opam:1.0.1",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__topkg__opam__c__1.0.1__52846a4c/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/ocamlbuild",
                                             "opam:0.14.0"],
                                             ["@opam/ocamlfind",
                                             "opam:1.8.1"],
                                             ["@opam/topkg", "opam:1.0.1"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@opam/tyxml",
  new Map([["opam:4.3.0",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__tyxml__opam__c__4.3.0__8f4dc81b/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:1.11.4"],
                                             ["@opam/re", "opam:1.9.0"],
                                             ["@opam/seq", "opam:base"],
                                             ["@opam/tyxml", "opam:4.3.0"],
                                             ["@opam/uutf", "opam:1.0.2"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@opam/uchar",
  new Map([["opam:0.0.2",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__uchar__opam__c__0.0.2__d1ad73a0/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/ocamlbuild",
                                             "opam:0.14.0"],
                                             ["@opam/uchar", "opam:0.0.2"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@opam/uutf",
  new Map([["opam:1.0.2",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__uutf__opam__c__1.0.2__34474f09/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/cmdliner", "opam:1.0.2"],
                                             ["@opam/ocamlbuild",
                                             "opam:0.14.0"],
                                             ["@opam/ocamlfind",
                                             "opam:1.8.1"],
                                             ["@opam/topkg", "opam:1.0.1"],
                                             ["@opam/uchar", "opam:0.0.2"],
                                             ["@opam/uutf", "opam:1.0.2"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@opam/yojson",
  new Map([["opam:1.7.0",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__yojson__opam__c__1.7.0__397feda6/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/biniou", "opam:1.2.1"],
                                             ["@opam/cppo", "opam:1.6.6"],
                                             ["@opam/dune", "opam:1.11.4"],
                                             ["@opam/easy-format",
                                             "opam:1.3.2"],
                                             ["@opam/yojson", "opam:1.7.0"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@opam/zed",
  new Map([["opam:2.0.5",
           {
             packageLocation: "/Users/kad/.esy/source/i/opam__s__zed__opam__c__2.0.5__b28263fe/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base-bytes",
                                             "opam:base"],
                                             ["@opam/camomile", "opam:1.0.2"],
                                             ["@opam/charInfo_width",
                                             "opam:1.1.0"],
                                             ["@opam/dune", "opam:1.11.4"],
                                             ["@opam/react", "opam:1.2.1"],
                                             ["@opam/result", "opam:1.4"],
                                             ["@opam/zed", "opam:2.0.5"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@reason-native/cli",
  new Map([["0.0.1-alpha",
           {
             packageLocation: "/Users/kad/.esy/source/i/reason_native__s__cli__0.0.1_alpha__cbdaf1ad/",
             packageDependencies: new Map([["@esy-ocaml/reason", "3.5.2"],
                                             ["@opam/dune", "opam:1.11.4"],
                                             ["@opam/re", "opam:1.9.0"],
                                             ["@reason-native/cli",
                                             "0.0.1-alpha"],
                                             ["@reason-native/pastel",
                                             "0.1.0"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@reason-native/console",
  new Map([["0.0.3",
           {
             packageLocation: "/Users/kad/.esy/source/i/reason_native__s__console__0.0.3__d326a79e/",
             packageDependencies: new Map([["@esy-ocaml/reason", "3.5.2"],
                                             ["@opam/dune", "opam:1.11.4"],
                                             ["@reason-native/console",
                                             "0.0.3"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@reason-native/file-context-printer",
  new Map([["0.0.3",
           {
             packageLocation: "/Users/kad/.esy/source/i/reason_native__s__file_context_printer__0.0.3__9dea979f/",
             packageDependencies: new Map([["@esy-ocaml/reason", "3.5.2"],
                                             ["@opam/dune", "opam:1.11.4"],
                                             ["@opam/re", "opam:1.9.0"],
                                             ["@reason-native/file-context-printer",
                                             "0.0.3"],
                                             ["@reason-native/pastel",
                                             "0.1.0"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@reason-native/pastel",
  new Map([["0.1.0",
           {
             packageLocation: "/Users/kad/.esy/source/i/reason_native__s__pastel__0.1.0__963e0746/",
             packageDependencies: new Map([["@esy-ocaml/reason", "3.5.2"],
                                             ["@opam/dune", "opam:1.11.4"],
                                             ["@reason-native/pastel",
                                             "0.1.0"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["@reason-native/rely",
  new Map([["3.2.1",
           {
             packageLocation: "/Users/kad/.esy/source/i/reason_native__s__rely__3.2.1__b79e06ab/",
             packageDependencies: new Map([["@esy-ocaml/reason", "3.5.2"],
                                             ["@opam/dune", "opam:1.11.4"],
                                             ["@opam/junit", "opam:2.0.2"],
                                             ["@opam/re", "opam:1.9.0"],
                                             ["@reason-native/cli",
                                             "0.0.1-alpha"],
                                             ["@reason-native/file-context-printer",
                                             "0.0.3"],
                                             ["@reason-native/pastel",
                                             "0.1.0"],
                                             ["@reason-native/rely", "3.2.1"],
                                             ["ocaml", "4.8.1000"]])}]])],
  ["esy-cmake",
  new Map([["github:prometheansacrifice/esy-cmake#2a47392def755",
           {
             packageLocation: "/Users/kad/.esy/source/i/esy_cmake__d5069d96/",
             packageDependencies: new Map([["esy-cmake",
                                           "github:prometheansacrifice/esy-cmake#2a47392def755"]])}]])],
  ["esy-freetype2",
  new Map([["2.9.1007",
           {
             packageLocation: "/Users/kad/.esy/source/i/esy_freetype2__2.9.1007__4e755043/",
             packageDependencies: new Map([["esy-cmake",
                                           "github:prometheansacrifice/esy-cmake#2a47392def755"],
                                             ["esy-freetype2", "2.9.1007"]])}]])],
  ["esy-harfbuzz",
  new Map([["1.9.1005",
           {
             packageLocation: "/Users/kad/.esy/source/i/esy_harfbuzz__1.9.1005__6ca99783/",
             packageDependencies: new Map([["esy-cmake",
                                           "github:prometheansacrifice/esy-cmake#2a47392def755"],
                                             ["esy-harfbuzz", "1.9.1005"]])}]])],
  ["esy-libjpeg-turbo",
  new Map([["github:revery-ui/libjpeg-turbo#61e031f",
           {
             packageLocation: "/Users/kad/.esy/source/i/esy_libjpeg_turbo__15863d51/",
             packageDependencies: new Map([["@esy-cross/ninja-build",
                                           "1.8.2001"],
                                             ["esy-cmake",
                                             "github:prometheansacrifice/esy-cmake#2a47392def755"],
                                             ["esy-libjpeg-turbo",
                                             "github:revery-ui/libjpeg-turbo#61e031f"],
                                             ["esy-nasm",
                                             "github:revery-ui/esy-nasm#64a802b"]])}]])],
  ["esy-nasm",
  new Map([["github:revery-ui/esy-nasm#64a802b",
           {
             packageLocation: "/Users/kad/.esy/source/i/esy_nasm__34a916d5/",
             packageDependencies: new Map([["esy-nasm",
                                           "github:revery-ui/esy-nasm#64a802b"]])}]])],
  ["esy-sdl2",
  new Map([["2.0.10005",
           {
             packageLocation: "/Users/kad/.esy/source/i/esy_sdl2__2.0.10005__1a276711/",
             packageDependencies: new Map([["esy-sdl2", "2.0.10005"]])}]])],
  ["esy-skia",
  new Map([["github:revery-ui/esy-skia#91b10c9",
           {
             packageLocation: "/Users/kad/.esy/source/i/esy_skia__bab6b598/",
             packageDependencies: new Map([["@esy-cross/ninja-build",
                                           "1.8.2001"],
                                             ["esy-libjpeg-turbo",
                                             "github:revery-ui/libjpeg-turbo#61e031f"],
                                             ["esy-skia",
                                             "github:revery-ui/esy-skia#91b10c9"]])}]])],
  ["flex",
  new Map([["1.2.2",
           {
             packageLocation: "/Users/kad/.esy/source/i/flex__1.2.2__1289221b/",
             packageDependencies: new Map([["@esy-ocaml/reason", "3.5.2"],
                                             ["@opam/dune", "opam:1.11.4"],
                                             ["flex", "1.2.2"],
                                             ["refmterr", "3.3.0"]])}]])],
  ["ocaml",
  new Map([["4.8.1000",
           {
             packageLocation: "/Users/kad/.esy/source/i/ocaml__4.8.1000__fac38140/",
             packageDependencies: new Map([["ocaml", "4.8.1000"]])}]])],
  ["reason-font-manager",
  new Map([["2.0.2",
           {
             packageLocation: "/Users/kad/.esy/source/i/reason_font_manager__2.0.2__12185485/",
             packageDependencies: new Map([["@esy-ocaml/reason", "3.5.2"],
                                             ["@reason-native/console",
                                             "0.0.3"],
                                             ["@reason-native/pastel",
                                             "0.1.0"],
                                             ["@reason-native/rely", "3.2.1"],
                                             ["ocaml", "4.8.1000"],
                                             ["reason-font-manager", "2.0.2"],
                                             ["refmterr", "3.3.0"]])}]])],
  ["reason-gl-matrix",
  new Map([["0.9.9307",
           {
             packageLocation: "/Users/kad/.esy/source/i/reason_gl_matrix__0.9.9307__49490553/",
             packageDependencies: new Map([["@esy-ocaml/reason", "3.5.2"],
                                             ["@opam/js_of_ocaml-compiler",
                                             "opam:3.5.0"],
                                             ["reason-gl-matrix", "0.9.9307"]])}]])],
  ["reason-harfbuzz",
  new Map([["1.91.5004",
           {
             packageLocation: "/Users/kad/.esy/source/i/reason_harfbuzz__1.91.5004__4351e527/",
             packageDependencies: new Map([["@esy-ocaml/reason", "3.5.2"],
                                             ["@opam/dune", "opam:1.11.4"],
                                             ["esy-harfbuzz", "1.9.1005"],
                                             ["ocaml", "4.8.1000"],
                                             ["reason-harfbuzz", "1.91.5004"]])}]])],
  ["reason-sdl2",
  new Map([["2.10.3017",
           {
             packageLocation: "/Users/kad/.esy/source/i/reason_sdl2__2.10.3017__b8a0d375/",
             packageDependencies: new Map([["@esy-ocaml/reason", "3.5.2"],
                                             ["@opam/dune", "opam:1.11.4"],
                                             ["@opam/lwt", "opam:4.5.0"],
                                             ["@opam/lwt_ppx", "opam:2.0.0"],
                                             ["esy-cmake",
                                             "github:prometheansacrifice/esy-cmake#2a47392def755"],
                                             ["esy-sdl2", "2.0.10005"],
                                             ["reason-gl-matrix", "0.9.9307"],
                                             ["reason-sdl2", "2.10.3017"],
                                             ["refmterr", "3.3.0"]])}]])],
  ["reason-skia",
  new Map([["github:revery-ui/reason-skia#69743dc",
           {
             packageLocation: "/Users/kad/.esy/source/i/reason_skia__decf6986/",
             packageDependencies: new Map([["@esy-ocaml/reason", "3.5.2"],
                                             ["@opam/ctypes", "opam:0.15.1"],
                                             ["@opam/ctypes-foreign",
                                             "opam:0.4.0"],
                                             ["@opam/dune", "opam:1.11.4"],
                                             ["@opam/lwt", "opam:4.5.0"],
                                             ["esy-freetype2", "2.9.1007"],
                                             ["esy-sdl2", "2.0.10005"],
                                             ["esy-skia",
                                             "github:revery-ui/esy-skia#91b10c9"],
                                             ["reason-sdl2", "2.10.3017"],
                                             ["reason-skia",
                                             "github:revery-ui/reason-skia#69743dc"],
                                             ["refmterr", "3.3.0"]])}]])],
  ["rebez",
  new Map([["github:jchavarri/rebez#03fa3b7",
           {
             packageLocation: "/Users/kad/.esy/source/i/rebez__17d87bec/",
             packageDependencies: new Map([["@esy-ocaml/reason", "3.5.2"],
                                             ["@opam/dune", "opam:1.11.4"],
                                             ["ocaml", "4.8.1000"],
                                             ["rebez",
                                             "github:jchavarri/rebez#03fa3b7"]])}]])],
  ["refmterr",
  new Map([["3.3.0",
           {
             packageLocation: "/Users/kad/.esy/source/i/refmterr__3.3.0__350d7b3d/",
             packageDependencies: new Map([["@esy-ocaml/reason", "3.5.2"],
                                             ["@opam/atdgen", "opam:2.0.0"],
                                             ["@opam/dune", "opam:1.11.4"],
                                             ["@opam/re", "opam:1.9.0"],
                                             ["@reason-native/console",
                                             "0.0.3"],
                                             ["@reason-native/pastel",
                                             "0.1.0"],
                                             ["ocaml", "4.8.1000"],
                                             ["refmterr", "3.3.0"]])}]])],
  ["rench",
  new Map([["1.9.1",
           {
             packageLocation: "/Users/kad/.esy/source/i/rench__1.9.1__73c7ad9b/",
             packageDependencies: new Map([["@esy-ocaml/reason", "3.5.2"],
                                             ["@opam/dune", "opam:1.11.4"],
                                             ["@opam/fpath", "opam:0.7.2"],
                                             ["@opam/lambda-term",
                                             "opam:2.0.3"],
                                             ["@opam/lwt", "opam:4.5.0"],
                                             ["@reason-native/console",
                                             "0.0.3"],
                                             ["@reason-native/rely", "3.2.1"],
                                             ["refmterr", "3.3.0"],
                                             ["rench", "1.9.1"]])}]])],
  ["reperf",
  new Map([["1.5.0",
           {
             packageLocation: "/Users/kad/.esy/source/i/reperf__1.5.0__7583eb09/",
             packageDependencies: new Map([["@esy-ocaml/reason", "3.5.2"],
                                             ["@opam/dune", "opam:1.11.4"],
                                             ["@opam/printbox", "opam:0.4"],
                                             ["@reason-native/pastel",
                                             "0.1.0"],
                                             ["ocaml", "4.8.1000"],
                                             ["refmterr", "3.3.0"],
                                             ["reperf", "1.5.0"]])}]])],
  ["revery",
  new Map([["github:revery-ui/revery#5438851",
           {
             packageLocation: "/Users/kad/.esy/source/i/revery__4533bffd/",
             packageDependencies: new Map([["@brisk/brisk-reconciler",
                                           "github:briskml/brisk-reconciler#0a2e476"],
                                             ["@esy-ocaml/reason", "3.5.2"],
                                             ["@opam/js_of_ocaml",
                                             "opam:3.5.2"],
                                             ["@opam/js_of_ocaml-compiler",
                                             "opam:3.5.0"],
                                             ["@opam/js_of_ocaml-lwt",
                                             "opam:3.5.2"],
                                             ["@opam/lwt", "opam:4.5.0"],
                                             ["@opam/lwt_ppx", "opam:2.0.0"],
                                             ["@opam/ppx_deriving",
                                             "opam:4.4.1"],
                                             ["@reason-native/console",
                                             "0.0.3"],
                                             ["@reason-native/rely", "3.2.1"],
                                             ["flex", "1.2.2"],
                                             ["reason-font-manager", "2.0.2"],
                                             ["reason-gl-matrix", "0.9.9307"],
                                             ["reason-harfbuzz", "1.91.5004"],
                                             ["reason-sdl2", "2.10.3017"],
                                             ["reason-skia",
                                             "github:revery-ui/reason-skia#69743dc"],
                                             ["rebez",
                                             "github:jchavarri/rebez#03fa3b7"],
                                             ["rench", "1.9.1"],
                                             ["reperf", "1.5.0"],
                                             ["revery",
                                             "github:revery-ui/revery#5438851"],
                                             ["revery-text-wrap",
                                             "github:revery-ui/revery-text-wrap#005385c"],
                                             ["timber",
                                             "github:glennsl/timber#ae065bb"]])}]])],
  ["revery-text-wrap",
  new Map([["github:revery-ui/revery-text-wrap#005385c",
           {
             packageLocation: "/Users/kad/.esy/source/i/revery_text_wrap__efbe1a06/",
             packageDependencies: new Map([["@opam/dune", "opam:1.11.4"],
                                             ["revery-text-wrap",
                                             "github:revery-ui/revery-text-wrap#005385c"]])}]])],
  ["timber",
  new Map([["github:glennsl/timber#ae065bb",
           {
             packageLocation: "/Users/kad/.esy/source/i/timber__314210ec/",
             packageDependencies: new Map([["@esy-ocaml/reason", "3.5.2"],
                                             ["@opam/dune", "opam:1.11.4"],
                                             ["@opam/fmt", "opam:0.8.8"],
                                             ["@opam/logs", "opam:0.7.0"],
                                             ["@opam/re", "opam:1.9.0"],
                                             ["ocaml", "4.8.1000"],
                                             ["refmterr", "3.3.0"],
                                             ["timber",
                                             "github:glennsl/timber#ae065bb"]])}]])],
  ["yarn-pkg-config",
  new Map([["github:esy-ocaml/yarn-pkg-config#cca65f99674ed2d954d28788edeb8c57fada5ed0",
           {
             packageLocation: "/Users/kad/.esy/source/i/yarn_pkg_config__71ddf21f/",
             packageDependencies: new Map([["yarn-pkg-config",
                                           "github:esy-ocaml/yarn-pkg-config#cca65f99674ed2d954d28788edeb8c57fada5ed0"]])}]])],
  [null,
  new Map([[null,
           {
             packageLocation: "/Users/kad/dev/grout/",
             packageDependencies: new Map([["@brisk/brisk-reconciler",
                                           "github:briskml/brisk-reconciler#0a2e476"],
                                             ["@esy-ocaml/reason", "3.5.2"],
                                             ["@opam/dune", "opam:1.11.4"],
                                             ["@opam/merlin", "opam:3.3.3"],
                                             ["@reason-native/rely", "3.2.1"],
                                             ["ocaml", "4.8.1000"],
                                             ["revery",
                                             "github:revery-ui/revery#5438851"],
                                             ["timber",
                                             "github:glennsl/timber#ae065bb"]])}]])]]);

let locatorsByLocations = new Map([
["../../", topLevelLocator],
  ["../../../../.esy/source/i/brisk__s__brisk_reconciler__32ca6d03/",
  {
    name: "@brisk/brisk-reconciler",
    reference: "github:briskml/brisk-reconciler#0a2e476"}],
  ["../../../../.esy/source/i/esy_cmake__d5069d96/",
  {
    name: "esy-cmake",
    reference: "github:prometheansacrifice/esy-cmake#2a47392def755"}],
  ["../../../../.esy/source/i/esy_cross__s__ninja_build__1.8.2001__fbfd8054/",
  {
    name: "@esy-cross/ninja-build",
    reference: "1.8.2001"}],
  ["../../../../.esy/source/i/esy_freetype2__2.9.1007__4e755043/",
  {
    name: "esy-freetype2",
    reference: "2.9.1007"}],
  ["../../../../.esy/source/i/esy_harfbuzz__1.9.1005__6ca99783/",
  {
    name: "esy-harfbuzz",
    reference: "1.9.1005"}],
  ["../../../../.esy/source/i/esy_libjpeg_turbo__15863d51/",
  {
    name: "esy-libjpeg-turbo",
    reference: "github:revery-ui/libjpeg-turbo#61e031f"}],
  ["../../../../.esy/source/i/esy_nasm__34a916d5/",
  {
    name: "esy-nasm",
    reference: "github:revery-ui/esy-nasm#64a802b"}],
  ["../../../../.esy/source/i/esy_ocaml__s__libffi__4f2caedb/",
  {
    name: "@esy-ocaml/libffi",
    reference: "github:esy-ocaml/libffi#c61127d"}],
  ["../../../../.esy/source/i/esy_ocaml__s__reason__3.5.2__98a6da55/",
  {
    name: "@esy-ocaml/reason",
    reference: "3.5.2"}],
  ["../../../../.esy/source/i/esy_ocaml__s__substs__0.0.1__19de1ee1/",
  {
    name: "@esy-ocaml/substs",
    reference: "0.0.1"}],
  ["../../../../.esy/source/i/esy_sdl2__2.0.10005__1a276711/",
  {
    name: "esy-sdl2",
    reference: "2.0.10005"}],
  ["../../../../.esy/source/i/esy_skia__bab6b598/",
  {
    name: "esy-skia",
    reference: "github:revery-ui/esy-skia#91b10c9"}],
  ["../../../../.esy/source/i/flex__1.2.2__1289221b/",
  {
    name: "flex",
    reference: "1.2.2"}],
  ["../../../../.esy/source/i/ocaml__4.8.1000__fac38140/",
  {
    name: "ocaml",
    reference: "4.8.1000"}],
  ["../../../../.esy/source/i/opam__s__astring__opam__c__0.8.3__3d7df80e/",
  {
    name: "@opam/astring",
    reference: "opam:0.8.3"}],
  ["../../../../.esy/source/i/opam__s__atd__opam__c__2.0.0__b632d97c/",
  {
    name: "@opam/atd",
    reference: "opam:2.0.0"}],
  ["../../../../.esy/source/i/opam__s__atdgen__opam__c__2.0.0__ce54a24a/",
  {
    name: "@opam/atdgen",
    reference: "opam:2.0.0"}],
  ["../../../../.esy/source/i/opam__s__atdgen_runtime__opam__c__2.0.0__2d033876/",
  {
    name: "@opam/atdgen-runtime",
    reference: "opam:2.0.0"}],
  ["../../../../.esy/source/i/opam__s__base__opam__c__v0.13.1__8883050b/",
  {
    name: "@opam/base",
    reference: "opam:v0.13.1"}],
  ["../../../../.esy/source/i/opam__s__base_bytes__opam__c__base__48b6019a/",
  {
    name: "@opam/base-bytes",
    reference: "opam:base"}],
  ["../../../../.esy/source/i/opam__s__base_threads__opam__c__base__f282958b/",
  {
    name: "@opam/base-threads",
    reference: "opam:base"}],
  ["../../../../.esy/source/i/opam__s__base_unix__opam__c__base__93427a57/",
  {
    name: "@opam/base-unix",
    reference: "opam:base"}],
  ["../../../../.esy/source/i/opam__s__biniou__opam__c__1.2.1__b33b4deb/",
  {
    name: "@opam/biniou",
    reference: "opam:1.2.1"}],
  ["../../../../.esy/source/i/opam__s__camomile__opam__c__1.0.2__f183008c/",
  {
    name: "@opam/camomile",
    reference: "opam:1.0.2"}],
  ["../../../../.esy/source/i/opam__s__charinfo__width__opam__c__1.1.0__83f68528/",
  {
    name: "@opam/charInfo_width",
    reference: "opam:1.1.0"}],
  ["../../../../.esy/source/i/opam__s__cmdliner__opam__c__1.0.2__22a2267f/",
  {
    name: "@opam/cmdliner",
    reference: "opam:1.0.2"}],
  ["../../../../.esy/source/i/opam__s__conf_m4__opam__c__1__7031fb84/",
  {
    name: "@opam/conf-m4",
    reference: "opam:1"}],
  ["../../../../.esy/source/i/opam__s__conf_pkg_config__opam__c__1.1__79849a14/",
  {
    name: "@opam/conf-pkg-config",
    reference: "opam:1.1"}],
  ["../../../../.esy/source/i/opam__s__cppo__opam__c__1.6.6__df887bb2/",
  {
    name: "@opam/cppo",
    reference: "opam:1.6.6"}],
  ["../../../../.esy/source/i/opam__s__ctypes__opam__c__0.15.1__1a0a3b62/",
  {
    name: "@opam/ctypes",
    reference: "opam:0.15.1"}],
  ["../../../../.esy/source/i/opam__s__ctypes_foreign__opam__c__0.4.0__8e21d25d/",
  {
    name: "@opam/ctypes-foreign",
    reference: "opam:0.4.0"}],
  ["../../../../.esy/source/i/opam__s__dune__opam__c__1.11.4__7815d6f1/",
  {
    name: "@opam/dune",
    reference: "opam:1.11.4"}],
  ["../../../../.esy/source/i/opam__s__dune_configurator__opam__c__1.0.0__1ed35223/",
  {
    name: "@opam/dune-configurator",
    reference: "opam:1.0.0"}],
  ["../../../../.esy/source/i/opam__s__easy_format__opam__c__1.3.2__f5ebc92b/",
  {
    name: "@opam/easy-format",
    reference: "opam:1.3.2"}],
  ["../../../../.esy/source/i/opam__s__fmt__opam__c__0.8.8__81d71639/",
  {
    name: "@opam/fmt",
    reference: "opam:0.8.8"}],
  ["../../../../.esy/source/i/opam__s__fpath__opam__c__0.7.2__d7c490cc/",
  {
    name: "@opam/fpath",
    reference: "opam:0.7.2"}],
  ["../../../../.esy/source/i/opam__s__integers__opam__c__0.3.0__ed48b907/",
  {
    name: "@opam/integers",
    reference: "opam:0.3.0"}],
  ["../../../../.esy/source/i/opam__s__jbuilder__opam__c__transition__90401214/",
  {
    name: "@opam/jbuilder",
    reference: "opam:transition"}],
  ["../../../../.esy/source/i/opam__s__js__of__ocaml__opam__c__3.5.2__6628a9fa/",
  {
    name: "@opam/js_of_ocaml",
    reference: "opam:3.5.2"}],
  ["../../../../.esy/source/i/opam__s__js__of__ocaml_compiler__opam__c__3.5.0__5e3f9041/",
  {
    name: "@opam/js_of_ocaml-compiler",
    reference: "opam:3.5.0"}],
  ["../../../../.esy/source/i/opam__s__js__of__ocaml_lwt__opam__c__3.5.2__f928b194/",
  {
    name: "@opam/js_of_ocaml-lwt",
    reference: "opam:3.5.2"}],
  ["../../../../.esy/source/i/opam__s__js__of__ocaml_ppx__opam__c__3.5.2__62a8f60b/",
  {
    name: "@opam/js_of_ocaml-ppx",
    reference: "opam:3.5.2"}],
  ["../../../../.esy/source/i/opam__s__junit__opam__c__2.0.2__380d7b58/",
  {
    name: "@opam/junit",
    reference: "opam:2.0.2"}],
  ["../../../../.esy/source/i/opam__s__lambda_term__opam__c__2.0.3__cf7cddb3/",
  {
    name: "@opam/lambda-term",
    reference: "opam:2.0.3"}],
  ["../../../../.esy/source/i/opam__s__logs__opam__c__0.7.0__cf15da05/",
  {
    name: "@opam/logs",
    reference: "opam:0.7.0"}],
  ["../../../../.esy/source/i/opam__s__lwt__log__opam__c__1.1.1__0a48d385/",
  {
    name: "@opam/lwt_log",
    reference: "opam:1.1.1"}],
  ["../../../../.esy/source/i/opam__s__lwt__opam__c__4.5.0__2c50b34d/",
  {
    name: "@opam/lwt",
    reference: "opam:4.5.0"}],
  ["../../../../.esy/source/i/opam__s__lwt__ppx__opam__c__2.0.0__cd63864d/",
  {
    name: "@opam/lwt_ppx",
    reference: "opam:2.0.0"}],
  ["../../../../.esy/source/i/opam__s__lwt__react__opam__c__1.1.3__86443f3c/",
  {
    name: "@opam/lwt_react",
    reference: "opam:1.1.3"}],
  ["../../../../.esy/source/i/opam__s__menhir__opam__c__20190924__cffc2327/",
  {
    name: "@opam/menhir",
    reference: "opam:20190924"}],
  ["../../../../.esy/source/i/opam__s__merlin__opam__c__3.3.3__4f09323c/",
  {
    name: "@opam/merlin",
    reference: "opam:3.3.3"}],
  ["../../../../.esy/source/i/opam__s__merlin_extend__opam__c__0.5__d71a3621/",
  {
    name: "@opam/merlin-extend",
    reference: "opam:0.5"}],
  ["../../../../.esy/source/i/opam__s__mmap__opam__c__1.1.0__2cba59f8/",
  {
    name: "@opam/mmap",
    reference: "opam:1.1.0"}],
  ["../../../../.esy/source/i/opam__s__ocaml_compiler_libs__opam__c__v0.12.1__b59f5bd2/",
  {
    name: "@opam/ocaml-compiler-libs",
    reference: "opam:v0.12.1"}],
  ["../../../../.esy/source/i/opam__s__ocaml_migrate_parsetree__opam__c__1.5.0__ef212ce2/",
  {
    name: "@opam/ocaml-migrate-parsetree",
    reference: "opam:1.5.0"}],
  ["../../../../.esy/source/i/opam__s__ocamlbuild__opam__c__0.14.0__aff6a0b0/",
  {
    name: "@opam/ocamlbuild",
    reference: "opam:0.14.0"}],
  ["../../../../.esy/source/i/opam__s__ocamlfind__opam__c__1.8.1__0bdaf9d3/",
  {
    name: "@opam/ocamlfind",
    reference: "opam:1.8.1"}],
  ["../../../../.esy/source/i/opam__s__ocplib_endian__opam__c__1.0__aceff5fc/",
  {
    name: "@opam/ocplib-endian",
    reference: "opam:1.0"}],
  ["../../../../.esy/source/i/opam__s__ppx__derivers__opam__c__1.2.1__a5e0f03f/",
  {
    name: "@opam/ppx_derivers",
    reference: "opam:1.2.1"}],
  ["../../../../.esy/source/i/opam__s__ppx__deriving__opam__c__4.4.1__5b015f9c/",
  {
    name: "@opam/ppx_deriving",
    reference: "opam:4.4.1"}],
  ["../../../../.esy/source/i/opam__s__ppx__tools__opam__c__6.0+4.08.0__763e17b8/",
  {
    name: "@opam/ppx_tools",
    reference: "opam:6.0+4.08.0"}],
  ["../../../../.esy/source/i/opam__s__ppx__tools__versioned__opam__c__5.2.3__18f062da/",
  {
    name: "@opam/ppx_tools_versioned",
    reference: "opam:5.2.3"}],
  ["../../../../.esy/source/i/opam__s__ppxfind__opam__c__1.3__6eea3af9/",
  {
    name: "@opam/ppxfind",
    reference: "opam:1.3"}],
  ["../../../../.esy/source/i/opam__s__ppxlib__opam__c__0.8.1__d9f90443/",
  {
    name: "@opam/ppxlib",
    reference: "opam:0.8.1"}],
  ["../../../../.esy/source/i/opam__s__printbox__opam__c__0.4__072574b0/",
  {
    name: "@opam/printbox",
    reference: "opam:0.4"}],
  ["../../../../.esy/source/i/opam__s__ptime__opam__c__0.8.5__79d19c69/",
  {
    name: "@opam/ptime",
    reference: "opam:0.8.5"}],
  ["../../../../.esy/source/i/opam__s__re__opam__c__1.9.0__0f723101/",
  {
    name: "@opam/re",
    reference: "opam:1.9.0"}],
  ["../../../../.esy/source/i/opam__s__react__opam__c__1.2.1__3f366b0c/",
  {
    name: "@opam/react",
    reference: "opam:1.2.1"}],
  ["../../../../.esy/source/i/opam__s__result__opam__c__1.4__51db07da/",
  {
    name: "@opam/result",
    reference: "opam:1.4"}],
  ["../../../../.esy/source/i/opam__s__seq__opam__c__base__a0c677b1/",
  {
    name: "@opam/seq",
    reference: "opam:base"}],
  ["../../../../.esy/source/i/opam__s__sexplib0__opam__c__v0.13.0__7f6e9078/",
  {
    name: "@opam/sexplib0",
    reference: "opam:v0.13.0"}],
  ["../../../../.esy/source/i/opam__s__stdio__opam__c__v0.13.0__d7d39043/",
  {
    name: "@opam/stdio",
    reference: "opam:v0.13.0"}],
  ["../../../../.esy/source/i/opam__s__stdlib_shims__opam__c__0.1.0__0eb3c4d9/",
  {
    name: "@opam/stdlib-shims",
    reference: "opam:0.1.0"}],
  ["../../../../.esy/source/i/opam__s__topkg__opam__c__1.0.1__52846a4c/",
  {
    name: "@opam/topkg",
    reference: "opam:1.0.1"}],
  ["../../../../.esy/source/i/opam__s__tyxml__opam__c__4.3.0__8f4dc81b/",
  {
    name: "@opam/tyxml",
    reference: "opam:4.3.0"}],
  ["../../../../.esy/source/i/opam__s__uchar__opam__c__0.0.2__d1ad73a0/",
  {
    name: "@opam/uchar",
    reference: "opam:0.0.2"}],
  ["../../../../.esy/source/i/opam__s__uutf__opam__c__1.0.2__34474f09/",
  {
    name: "@opam/uutf",
    reference: "opam:1.0.2"}],
  ["../../../../.esy/source/i/opam__s__yojson__opam__c__1.7.0__397feda6/",
  {
    name: "@opam/yojson",
    reference: "opam:1.7.0"}],
  ["../../../../.esy/source/i/opam__s__zed__opam__c__2.0.5__b28263fe/",
  {
    name: "@opam/zed",
    reference: "opam:2.0.5"}],
  ["../../../../.esy/source/i/reason_font_manager__2.0.2__12185485/",
  {
    name: "reason-font-manager",
    reference: "2.0.2"}],
  ["../../../../.esy/source/i/reason_gl_matrix__0.9.9307__49490553/",
  {
    name: "reason-gl-matrix",
    reference: "0.9.9307"}],
  ["../../../../.esy/source/i/reason_harfbuzz__1.91.5004__4351e527/",
  {
    name: "reason-harfbuzz",
    reference: "1.91.5004"}],
  ["../../../../.esy/source/i/reason_native__s__cli__0.0.1_alpha__cbdaf1ad/",
  {
    name: "@reason-native/cli",
    reference: "0.0.1-alpha"}],
  ["../../../../.esy/source/i/reason_native__s__console__0.0.3__d326a79e/",
  {
    name: "@reason-native/console",
    reference: "0.0.3"}],
  ["../../../../.esy/source/i/reason_native__s__file_context_printer__0.0.3__9dea979f/",
  {
    name: "@reason-native/file-context-printer",
    reference: "0.0.3"}],
  ["../../../../.esy/source/i/reason_native__s__pastel__0.1.0__963e0746/",
  {
    name: "@reason-native/pastel",
    reference: "0.1.0"}],
  ["../../../../.esy/source/i/reason_native__s__rely__3.2.1__b79e06ab/",
  {
    name: "@reason-native/rely",
    reference: "3.2.1"}],
  ["../../../../.esy/source/i/reason_sdl2__2.10.3017__b8a0d375/",
  {
    name: "reason-sdl2",
    reference: "2.10.3017"}],
  ["../../../../.esy/source/i/reason_skia__decf6986/",
  {
    name: "reason-skia",
    reference: "github:revery-ui/reason-skia#69743dc"}],
  ["../../../../.esy/source/i/rebez__17d87bec/",
  {
    name: "rebez",
    reference: "github:jchavarri/rebez#03fa3b7"}],
  ["../../../../.esy/source/i/refmterr__3.3.0__350d7b3d/",
  {
    name: "refmterr",
    reference: "3.3.0"}],
  ["../../../../.esy/source/i/rench__1.9.1__73c7ad9b/",
  {
    name: "rench",
    reference: "1.9.1"}],
  ["../../../../.esy/source/i/reperf__1.5.0__7583eb09/",
  {
    name: "reperf",
    reference: "1.5.0"}],
  ["../../../../.esy/source/i/revery__4533bffd/",
  {
    name: "revery",
    reference: "github:revery-ui/revery#5438851"}],
  ["../../../../.esy/source/i/revery_text_wrap__efbe1a06/",
  {
    name: "revery-text-wrap",
    reference: "github:revery-ui/revery-text-wrap#005385c"}],
  ["../../../../.esy/source/i/timber__314210ec/",
  {
    name: "timber",
    reference: "github:glennsl/timber#ae065bb"}],
  ["../../../../.esy/source/i/yarn_pkg_config__71ddf21f/",
  {
    name: "yarn-pkg-config",
    reference: "github:esy-ocaml/yarn-pkg-config#cca65f99674ed2d954d28788edeb8c57fada5ed0"}]]);


  exports.findPackageLocator = function findPackageLocator(location) {
    let relativeLocation = normalizePath(path.relative(__dirname, location));

    if (!relativeLocation.match(isStrictRegExp))
      relativeLocation = `./${relativeLocation}`;

    if (location.match(isDirRegExp) && relativeLocation.charAt(relativeLocation.length - 1) !== '/')
      relativeLocation = `${relativeLocation}/`;

    let match;

  
      if (relativeLocation.length >= 85 && relativeLocation[84] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 85)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 84 && relativeLocation[83] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 84)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 83 && relativeLocation[82] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 83)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 82 && relativeLocation[81] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 82)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 79 && relativeLocation[78] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 79)))
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
      

      if (relativeLocation.length >= 60 && relativeLocation[59] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 60)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 59 && relativeLocation[58] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 59)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 57 && relativeLocation[56] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 57)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 56 && relativeLocation[55] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 56)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 54 && relativeLocation[53] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 54)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 53 && relativeLocation[52] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 53)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 52 && relativeLocation[51] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 52)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 50 && relativeLocation[49] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 50)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 49 && relativeLocation[48] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 49)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 48 && relativeLocation[47] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 48)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 46 && relativeLocation[45] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 46)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 45 && relativeLocation[44] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 45)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 43 && relativeLocation[42] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 43)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 42 && relativeLocation[41] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 42)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 6 && relativeLocation[5] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 6)))
          return blacklistCheck(match);
      

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
      `Couldn't find a matching entry in the dependency tree for the specified parent (this is probably an internal error)`,
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
        unqualifiedPath = nextUnqualifiedPath;
        continue;
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

// eslint-disable-next-line no-unused-vars
function normalizePath(fsPath) {
  return process.platform === 'win32' ? fsPath.replace(backwardSlashRegExp, '/') : fsPath;
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
  // Bailout if the request is a native module

  if (considerBuiltins && builtinModules.has(request)) {
    return null;
  }

  // We allow disabling the pnp resolution for some subpaths. This is because some projects, often legacy,
  // contain multiple levels of dependencies (ie. a yarn.lock inside a subfolder of a yarn.lock). This is
  // typically solved using workspaces, but not all of them have been converted already.

  if (ignorePattern && ignorePattern.test(issuer)) {
    const result = callNativeResolution(request, issuer);

    if (result === false) {
      throw makeError(
        `BUILTIN_NODE_RESOLUTION_FAIL`,
        `The builtin node resolution algorithm was unable to resolve the module referenced by "${request}" and requested from "${issuer}" (it didn't go through the pnp resolver because the issuer was explicitely ignored by the regexp "$$BLACKLIST")`,
        {
          request,
          issuer,
        },
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
          },
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
            {request, issuer, dependencyName},
          );
        } else {
          throw makeError(
            `MISSING_PEER_DEPENDENCY`,
            `Package "${issuerLocator.name}@${issuerLocator.reference}" is trying to access a peer dependency ("${dependencyName}") that should be provided by its direct ancestor but isn't`,
            {request, issuer, issuerLocator: Object.assign({}, issuerLocator), dependencyName},
          );
        }
      } else {
        if (issuerLocator === topLevelLocator) {
          throw makeError(
            `UNDECLARED_DEPENDENCY`,
            `You cannot require a package ("${dependencyName}") that is not declared in your dependencies (via "${issuer}")`,
            {request, issuer, dependencyName},
          );
        } else {
          const candidates = Array.from(issuerInformation.packageDependencies.keys());
          throw makeError(
            `UNDECLARED_DEPENDENCY`,
            `Package "${issuerLocator.name}@${issuerLocator.reference}" (via "${issuer}") is trying to require the package "${dependencyName}" (via "${request}") without it being listed in its dependencies (${candidates.join(
              `, `,
            )})`,
            {request, issuer, issuerLocator: Object.assign({}, issuerLocator), dependencyName, candidates},
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
        {request, issuer, dependencyLocator: Object.assign({}, dependencyLocator)},
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
  {extensions = Object.keys(Module._extensions)} = {},
) {
  const qualifiedPath = applyNodeExtensionResolution(unqualifiedPath, {extensions});

  if (qualifiedPath) {
    return path.normalize(qualifiedPath);
  } else {
    throw makeError(
      `QUALIFIED_PATH_RESOLUTION_FAILED`,
      `Couldn't find a suitable Node resolution for unqualified path "${unqualifiedPath}"`,
      {unqualifiedPath},
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
          exports.resolveToUnqualified(request, realIssuer, {extensions});
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
          },
        );
      }
    }
    throw originalError;
  }

  if (unqualifiedPath === null) {
    return null;
  }

  try {
    return exports.resolveUnqualified(unqualifiedPath);
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

    if (patchedModules.has(request)) {
      module.exports = patchedModules.get(request)(module.exports);
    }

    return module.exports;
  };

  const originalModuleResolveFilename = Module._resolveFilename;

  Module._resolveFilename = function(request, parent, isMain, options) {
    if (!enableNativeHooks) {
      return originalModuleResolveFilename.call(Module, request, parent, isMain, options);
    }

    const issuerModule = getIssuerModule(parent);
    const issuer = issuerModule ? issuerModule.filename : process.cwd() + '/';

    const resolution = exports.resolveRequest(request, issuer);
    return resolution !== null ? resolution : request;
  };

  const originalFindPath = Module._findPath;

  Module._findPath = function(request, paths, isMain) {
    if (!enableNativeHooks) {
      return originalFindPath.call(Module, request, paths, isMain);
    }

    for (const path of paths) {
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

  if (process.env.ESY__NODE_BIN_PATH != null) {
    const delimiter = require('path').delimiter;
    process.env.PATH = `${process.env.ESY__NODE_BIN_PATH}${delimiter}${process.env.PATH}`;
  }
};

exports.setupCompatibilityLayer = () => {
  // see https://github.com/browserify/resolve/blob/master/lib/caller.js
  const getCaller = () => {
    const origPrepareStackTrace = Error.prepareStackTrace;

    Error.prepareStackTrace = (_, stack) => stack;
    const stack = new Error().stack;
    Error.prepareStackTrace = origPrepareStackTrace;

    return stack[2].getFileName();
  };

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

  // We need to shim the "resolve" module, because Liftoff uses it in order to find the location
  // of the module in the dependency tree. And Liftoff is used to power Gulp, which doesn't work
  // at all unless modulePath is set, which we cannot configure from any other way than through
  // the Liftoff pipeline (the key isn't whitelisted for env or cli options).

  patchedModules.set(/^resolve$/, realResolve => {
    const mustBeShimmed = caller => {
      const callerLocator = exports.findPackageLocator(caller);

      return callerLocator && callerLocator.name === 'liftoff';
    };

    const attachCallerToOptions = (caller, options) => {
      if (!options.basedir) {
        options.basedir = path.dirname(caller);
      }
    };

    const resolveSyncShim = (request, {basedir}) => {
      return exports.resolveRequest(request, basedir, {
        considerBuiltins: false,
      });
    };

    const resolveShim = (request, options, callback) => {
      setImmediate(() => {
        let error;
        let result;

        try {
          result = resolveSyncShim(request, options);
        } catch (thrown) {
          error = thrown;
        }

        callback(error, result);
      });
    };

    return Object.assign(
      (request, options, callback) => {
        if (typeof options === 'function') {
          callback = options;
          options = {};
        } else if (!options) {
          options = {};
        }

        const caller = getCaller();
        attachCallerToOptions(caller, options);

        if (mustBeShimmed(caller)) {
          return resolveShim(request, options, callback);
        } else {
          return realResolve.sync(request, options, callback);
        }
      },
      {
        sync: (request, options) => {
          if (!options) {
            options = {};
          }

          const caller = getCaller();
          attachCallerToOptions(caller, options);

          if (mustBeShimmed(caller)) {
            return resolveSyncShim(request, options);
          } else {
            return realResolve.sync(request, options);
          }
        },
        isCore: request => {
          return realResolve.isCore(request);
        },
      },
    );
  });
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
