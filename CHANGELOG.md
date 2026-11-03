# Changelog

## [2.6.1](https://github.com/wbd-streaming/labs-sdk-ts/compare/v2.6.0...v2.6.1) (2026-09-05)


### Bug Fixes

* resolve package root exports for CJS and browser consumers ([#140](https://github.com/wbd-streaming/labs-sdk-ts/issues/140)) ([962096d](https://github.com/wbd-streaming/labs-sdk-ts/commit/962096deb029fde7ada1dd1d2a7cd8bbce510a68))

## [2.6.0](https://github.com/wbd-streaming/labs-sdk-ts/compare/v2.5.2...v2.6.0) (2026-08-19)


### Features

* self-loading experiment/flag cache, metrics, and cross-SDK labs-cli ([#133](https://github.com/wbd-streaming/labs-sdk-ts/issues/133)) ([ee798a4](https://github.com/wbd-streaming/labs-sdk-ts/commit/ee798a4de24e1fa9fc6d7c0a278ddf5f60b90206))
* ship a proper dual-format package (CJS + ESM + browser) via exports map ([#138](https://github.com/wbd-streaming/labs-sdk-ts/issues/138)) ([9906858](https://github.com/wbd-streaming/labs-sdk-ts/commit/990685814d97febf175f4c91fcb3956525a610db))

## [2.5.2](https://github.com/wbd-streaming/labs-sdk-ts/compare/v2.5.1...v2.5.2) (2026-07-30)


### Bug Fixes

* move json-logic-engine to dependencies ([#136](https://github.com/wbd-streaming/labs-sdk-ts/issues/136)) ([47dab2b](https://github.com/wbd-streaming/labs-sdk-ts/commit/47dab2b5611e5f2ddaeb89f66b23eb81fd761210))

## [2.5.1](https://github.com/wbd-streaming/labs-sdk-ts/compare/v2.5.0...v2.5.1) (2026-07-30)


### Bug Fixes

* convert from ESM to CJS ([#134](https://github.com/wbd-streaming/labs-sdk-ts/issues/134)) ([a428c0f](https://github.com/wbd-streaming/labs-sdk-ts/commit/a428c0f022625904527c05d7d52c3eaf6ef32d22))

## [2.5.0](https://github.com/wbd-streaming/labs-sdk-ts/compare/v2.4.2...v2.5.0) (2026-06-18)


### Features

* **decision:** Go SDK parity for decision engine ([#130](https://github.com/wbd-streaming/labs-sdk-ts/issues/130)) ([d1b17c3](https://github.com/wbd-streaming/labs-sdk-ts/commit/d1b17c362b8ed29b9652f52146980d59a2d9f76e))
* **query:** add locale-aware icase_compare quantifiers and comparisons ([#127](https://github.com/wbd-streaming/labs-sdk-ts/issues/127)) ([18d91f6](https://github.com/wbd-streaming/labs-sdk-ts/commit/18d91f69e04c013bf7de47e31a97a788ac5638ce))


### Bug Fixes

* **test:** harden distribution-accuracy test against CI false failures ([#132](https://github.com/wbd-streaming/labs-sdk-ts/issues/132)) ([de0e17b](https://github.com/wbd-streaming/labs-sdk-ts/commit/de0e17b042497608c3826653c03b5ee521df27e1))

## [2.4.2](https://github.com/wbd-streaming/labs-sdk-ts/compare/v2.4.1...v2.4.2) (2025-10-02)


### Bug Fixes

* CD-49783 refactor to use json-logic-engine ([#125](https://github.com/wbd-streaming/labs-sdk-ts/issues/125)) ([f131bc5](https://github.com/wbd-streaming/labs-sdk-ts/commit/f131bc583ca440a891996cb5a1a30937c69aaaf6))

## [2.4.1](https://github.com/wbd-streaming/labs-sdk-ts/compare/v2.4.0...v2.4.1) (2025-09-16)


### Bug Fixes

* CD-49783 add audience query support ([#122](https://github.com/wbd-streaming/labs-sdk-ts/issues/122)) ([a9f982e](https://github.com/wbd-streaming/labs-sdk-ts/commit/a9f982e1a3cfd191c2b0c9e3a416e037432642d0))

## [2.4.0](https://github.com/wbd-streaming/labs-sdk-ts/compare/v2.3.2...v2.4.0) (2025-09-05)


### Features

* updates for release ([#120](https://github.com/wbd-streaming/labs-sdk-ts/issues/120)) ([8f9cad5](https://github.com/wbd-streaming/labs-sdk-ts/commit/8f9cad5b3d55dd9ed3e602269a401474cd07d37d))

## [2.3.2](https://github.com/wbd-streaming/labs-sdk-ts/compare/v2.3.1...v2.3.2) (2025-08-19)


### Bug Fixes

* Tracking was too loose ([#117](https://github.com/wbd-streaming/labs-sdk-ts/issues/117)) ([e9adaa9](https://github.com/wbd-streaming/labs-sdk-ts/commit/e9adaa9f39006141b825ff1f11bb7dbe9034b38e))

## [2.3.1](https://github.com/wbd-streaming/labs-sdk-ts/compare/v2.3.0...v2.3.1) (2025-06-13)


### Bug Fixes

* Buckets are numbers, not string ([#115](https://github.com/wbd-streaming/labs-sdk-ts/issues/115)) ([520343a](https://github.com/wbd-streaming/labs-sdk-ts/commit/520343a9c7568849076461a5a8fc8c7c7a7372e8))

## [2.3.0](https://github.com/wbd-streaming/labs-sdk-ts/compare/v2.2.0...v2.3.0) (2025-04-21)


### Features

* Bucket numbers in decision stream ([#106](https://github.com/wbd-streaming/labs-sdk-ts/issues/106)) ([506b7e2](https://github.com/wbd-streaming/labs-sdk-ts/commit/506b7e28492445d2b554d3e2c6666e8ba6c449d2))

## [2.2.0](https://github.com/wbd-streaming/labs-sdk-ts/compare/v2.1.1...v2.2.0) (2024-12-09)


### Features

* Add tracing support for observability ([#90](https://github.com/wbd-streaming/labs-sdk-ts/issues/90)) ([fc1bbae](https://github.com/wbd-streaming/labs-sdk-ts/commit/fc1bbae88b31d1abd8c643361564536ec8722539))

## [2.1.1](https://github.com/wbd-streaming/labs-sdk-ts/compare/v2.1.0...v2.1.1) (2024-10-29)


### Bug Fixes

* json field misnaming fixed (groupId -&gt; group_id) ([#88](https://github.com/wbd-streaming/labs-sdk-ts/issues/88)) ([16d99c5](https://github.com/wbd-streaming/labs-sdk-ts/commit/16d99c5fce41a2073abf6dc839edcb26108b2adc))

## [2.1.0](https://github.com/wbd-streaming/labs-sdk-ts/compare/v2.0.0...v2.1.0) (2024-10-10)


### Features

* **MAB:** Implement MAB decisioning ([#85](https://github.com/wbd-streaming/labs-sdk-ts/issues/85)) ([b71e7f5](https://github.com/wbd-streaming/labs-sdk-ts/commit/b71e7f521755c6486be1d8dbd0ae5742255313bf))

## [2.0.0](https://github.com/wbd-streaming/labs-sdk-ts/compare/v1.8.0...v2.0.0) (2024-10-09)


### ⚠ BREAKING CHANGES

* **TrafficPercentageAndMEG:** ITC-3239 - Traffic ramp up and MEG([#61](https://github.com/wbd-streaming/labs-sdk-ts/issues/61))

### Features

* **TrafficPercentageAndMEG:** ITC-3239 - Traffic ramp up and MEG([#61](https://github.com/wbd-streaming/labs-sdk-ts/issues/61)) ([aee0ad1](https://github.com/wbd-streaming/labs-sdk-ts/commit/aee0ad18d079ce8887b5ab7046ece45227364080))

## [1.8.0](https://github.com/wbd-streaming/labs-sdk-ts/compare/v1.7.0...v1.8.0) (2024-08-02)


### Features

* Support for multiple experiments ([#69](https://github.com/wbd-streaming/labs-sdk-ts/issues/69)) ([0f58943](https://github.com/wbd-streaming/labs-sdk-ts/commit/0f589432b3a1e388806e8b0074a7f705ac9997ca))

## [1.7.0](https://github.com/wbd-streaming/labs-sdk-ts/compare/v1.6.1...v1.7.0) (2024-04-12)


### Features

* **DeferredDecision:** ITC-6123-Added getDeferredDecision method ([#65](https://github.com/wbd-streaming/labs-sdk-ts/issues/65)) ([a8992ae](https://github.com/wbd-streaming/labs-sdk-ts/commit/a8992aeaf4db88466ff74a584fa45a30999d52cb))
* **dependabot:** add dependabot ([#43](https://github.com/wbd-streaming/labs-sdk-ts/issues/43)) ([271ac1c](https://github.com/wbd-streaming/labs-sdk-ts/commit/271ac1c936308ef52c13569894f742e96377ebff))

## [1.6.1](https://github.com/wbd-streaming/labs-sdk-ts/compare/v1.6.0...v1.6.1) (2024-01-19)


### Bug Fixes

* ITC-5433 add context to tracking payload ([#41](https://github.com/wbd-streaming/labs-sdk-ts/issues/41)) ([a41efb2](https://github.com/wbd-streaming/labs-sdk-ts/commit/a41efb24639e7d043b59bf3e39200d67ee69dabd))

## [1.6.0](https://github.com/wbd-streaming/labs-sdk-ts/compare/v1.5.3...v1.6.0) (2023-12-07)


### Features

* Add support for calling Labs track() endpoint ([#39](https://github.com/wbd-streaming/labs-sdk-ts/issues/39)) ([6275324](https://github.com/wbd-streaming/labs-sdk-ts/commit/6275324aa87a342747c758e3d705e6653fd656eb))

## [1.5.3](https://github.com/wbd-streaming/labs-sdk-ts/compare/v1.5.2...v1.5.3) (2023-11-07)


### Bug Fixes

* Remove leftover bigint references ([#36](https://github.com/wbd-streaming/labs-sdk-ts/issues/36)) ([4296de5](https://github.com/wbd-streaming/labs-sdk-ts/commit/4296de58043ab409a026cc5da2915283dc982b0c))
* Removed obsolete undici.d.ts ([4296de5](https://github.com/wbd-streaming/labs-sdk-ts/commit/4296de58043ab409a026cc5da2915283dc982b0c))

## [1.5.2](https://github.com/wbd-streaming/labs-sdk-ts/compare/v1.5.1...v1.5.2) (2023-10-04)


### Bug Fixes

* Bucket assignmed was off by 1 ([#33](https://github.com/wbd-streaming/labs-sdk-ts/issues/33)) ([c03e522](https://github.com/wbd-streaming/labs-sdk-ts/commit/c03e5220a907c659be6b68b5daf710b018476a6f))

## [1.5.1](https://github.com/wbd-streaming/labs-sdk-ts/compare/v1.5.0...v1.5.1) (2023-09-14)


### Bug Fixes

* ITC-4081 update OMD tags to new business service ([#31](https://github.com/wbd-streaming/labs-sdk-ts/issues/31)) ([12ec36f](https://github.com/wbd-streaming/labs-sdk-ts/commit/12ec36fbf910108f0d60207883b8514c691a195d))

## [1.5.0](https://github.com/wbd-streaming/labs-sdk-ts/compare/v1.4.0...v1.5.0) (2023-02-21)


### Features

* ITC-1740: Support multi-value user context values input ([#28](https://github.com/wbd-streaming/labs-sdk-ts/issues/28)) ([1a05d12](https://github.com/wbd-streaming/labs-sdk-ts/commit/1a05d12e4ca60c12b3edb6d608f5e25ff31098c9))

## [1.4.0](https://github.com/wbd-streaming/labs-sdk-ts/compare/v1.3.1...v1.4.0) (2023-02-13)


### Features

* audience and allow-list support ([#26](https://github.com/wbd-streaming/labs-sdk-ts/issues/26)) ([6cd91fd](https://github.com/wbd-streaming/labs-sdk-ts/commit/6cd91fd25bb4805700b2246259ce9422ec15053e))

## [1.3.1](https://github.com/wbd-streaming/labs-sdk-ts/compare/v1.3.0...v1.3.1) (2023-02-09)


### Bug Fixes

* Edge handing error with bad input ([#24](https://github.com/wbd-streaming/labs-sdk-ts/issues/24)) ([a820474](https://github.com/wbd-streaming/labs-sdk-ts/commit/a820474001f7e5ee8b91bca37031064ab64cb061))

## [1.3.0](https://github.com/wbd-streaming/labs-sdk-ts/compare/v1.2.0...v1.3.0) (2023-02-07)

### Features

* updated readme ([#22](https://github.com/wbd-streaming/labs-sdk-ts/issues/22)) ([d3a2a9a](https://github.com/wbd-streaming/labs-sdk-ts/commit/d3a2a9ad3c2e852bba88fa43a1666bd00bb3a92b))
* feat: first stubs for audience/whitelist

* feat: Build as single .js ES Module ([#21](https://github.com/wbd-streaming/labs-sdk-ts/issues/21)) ([diffs](https://github.com/wbd-streaming/labs-sdk-ts/pull/21/files))
* feat: Add some examples

### Bug Fixes

* fix: remove ts-loader ([#22](https://github.com/wbd-streaming/labs-sdk-ts/issues/22)) ([d3a2a9a](https://github.com/wbd-streaming/labs-sdk-ts/commit/d3a2a9ad3c2e852bba88fa43a1666bd00bb3a92b))
* fix: remove dead import
* fix: Drop in a browser compat readBigUInt64BE ([#21](https://github.com/wbd-streaming/labs-sdk-ts/issues/21)) ([diffs](https://github.com/wbd-streaming/labs-sdk-ts/pull/21/files))
* fix: Add a status field to decision reponse
* fix: If experiment id mismatch, don't use info from config. Return an empty error result marked as inactive and control
* fix: Consistent double quotes

## [1.2.0](https://github.com/wbd-streaming/labs-sdk-ts/compare/v1.1.0...v1.2.0) (2023-01-27)

### Features

* allow client to get experiment data with config input ([#20](https://github.com/wbd-streaming/labs-sdk-ts/issues/20)) ([291119e](https://github.com/wbd-streaming/labs-sdk-ts/commit/291119eeebe85d3202d47bbcd3399ada8bee6d31))
* flatten API ([#18](https://github.com/wbd-streaming/labs-sdk-ts/issues/18)) ([c9dc506](https://github.com/wbd-streaming/labs-sdk-ts/commit/c9dc506136689365d50920f1baddb23ecb4587cd))


### Bug Fixes

* Add package-lock.json to artifacts ([#16](https://github.com/wbd-streaming/labs-sdk-ts/issues/16)) ([72c9e35](https://github.com/wbd-streaming/labs-sdk-ts/commit/72c9e3537ad051a81fa7fd06e5bd3995a9264b14))

## [1.1.0](https://github.com/wbd-streaming/labs-sdk-ts/compare/v1.0.5...v1.1.0) (2023-01-20)


### Features

* calling decision api with no dependencies enabled ([16485bc](https://github.com/wbd-streaming/labs-sdk-ts/commit/16485bc1a68063de265db5ba8be3cc78918d5ee6))
* Stubs for the SDK interface ([#10](https://github.com/wbd-streaming/labs-sdk-ts/issues/10)) ([16485bc](https://github.com/wbd-streaming/labs-sdk-ts/commit/16485bc1a68063de265db5ba8be3cc78918d5ee6))

## [1.0.5](https://github.com/wbd-streaming/labs-sdk-ts/compare/v1.0.4...v1.0.5) (2023-01-19)


### Bug Fixes

* include src in publish ([#13](https://github.com/wbd-streaming/labs-sdk-ts/issues/13)) ([d0c6ba5](https://github.com/wbd-streaming/labs-sdk-ts/commit/d0c6ba5aaf520d7560f9803c0bc3af7c5afaeacd))

## [1.0.4](https://github.com/wbd-streaming/labs-sdk-ts/compare/v1.0.3...v1.0.4) (2023-01-19)


### Bug Fixes

* make sure to only publish dist to npm ([#11](https://github.com/wbd-streaming/labs-sdk-ts/issues/11)) ([4902f13](https://github.com/wbd-streaming/labs-sdk-ts/commit/4902f13bcc5fc9ab50336bb26e7b544a35d42050))

## [1.0.3](https://github.com/wbd-streaming/labs-sdk-ts/compare/v1.0.2...v1.0.3) (2023-01-17)


### Bug Fixes

* try with name change ([#8](https://github.com/wbd-streaming/labs-sdk-ts/issues/8)) ([32476cc](https://github.com/wbd-streaming/labs-sdk-ts/commit/32476cc808d0be93d0bf31c80ab24bd1b4615150))

## [1.0.2](https://github.com/wbd-streaming/labs-sdk-ts/compare/v1.0.1...v1.0.2) (2023-01-17)


### Bug Fixes

* add npm config ([#6](https://github.com/wbd-streaming/labs-sdk-ts/issues/6)) ([99f4abc](https://github.com/wbd-streaming/labs-sdk-ts/commit/99f4abc181b5f6acea1e6a7233c9303b12507b03))

## [1.0.1](https://github.com/wbd-streaming/labs-sdk-ts/compare/v1.0.0...v1.0.1) (2023-01-17)


### Bug Fixes

* install dependencies before publish ([#4](https://github.com/wbd-streaming/labs-sdk-ts/issues/4)) ([ab03bc5](https://github.com/wbd-streaming/labs-sdk-ts/commit/ab03bc5290fad2db2ee2c9bf259a2f4bcbfda51f))

## 1.0.0 (2023-01-17)


### Features

* init ([#2](https://github.com/wbd-streaming/labs-sdk-ts/issues/2)) ([aaf1df0](https://github.com/wbd-streaming/labs-sdk-ts/commit/aaf1df07a0c27a417fc1e83f685b25ffeaf574b1))
