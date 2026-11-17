# SenCity export for the app: survey v9

- Source commit: 96fefc3bad71c2f0eeb066884741382dafc75ffc
- Export date: 2026-11-17
- Codebook: config/codebook_2026-11-12.yaml (version 2026-11-12, sha 91b6f48a684a)
- Contains no participant data, no images, no API keys.
- Profile: every field is filled from `part_a.json` alone (A11, A12, A13, A16) plus the answer language; no field comes from A1-A5 or A15.
- Task: `task_template.txt` is the study's v9 single-photo task text (B1 + B2, eight-senses line included); the element list is filled per photo (`task_rules.json`).
- Presence check (D150, run once on the 20 study photos, untuned): agreement with the confirmed lists 91.7% (365/398 answers); 96% of the confirmed elements found; 82% of the model's elements are in the confirmed lists. App lists run about 18% long, mostly Direct sun, Shade and Nice buildings; Crowds was missed on 3 of 20 photos. App presence prompt (D157): the strict prompt plus the crowds definition (about 5 or more people close together, or people across most of the walkable space); run once on the same 20 photos: agreement 91.7% (365/398), 96% found, 83% confirmed; Crowds still missed on 3 of 20 (place04, place10, place19). Future work: users review the automatic lists before they are used.
- Study lists: `study_lists.json` is the confirmed element list per study photo (place01-20); place17's Direct sun and Shade are `visible_not_listed` (not offered, not absent).

## Files (sha256)

- `elements.json`: 8fec3f655dc520195b01a72dae1735f1e7141daebfc7c0944e2f87e727783c85
- `part_a.json`: 14416545311920bdb29254aa622abc26de240185b3a4db607a028f6507a997d5
- `profile_template.txt`: 5b570f4a71e2e52bff56f05181b61dc34fb79e6073208a15ee5177bd4a468366
- `profile_rules.json`: b2d9648b1b987395d48285d5b71278d73e88e9f6396044035fcf8a24fea4c1cf
- `system_instruction.txt`: 3c7bc0dede812e55d42cd79edfb247d5538ee5ee82c2b25a8dbf04bda9e087c7
- `task_template.txt`: 2741088bd97a6c6c111d51de672de84b87e1dbf4c9779f79cb07926739fea0c5
- `task_rules.json`: f3959a0db1a7ddace32e249d9ee53f4d04c9d9605b48f128dd45252099ac0864
- `schema_template.json`: 5d296ff5fc593134b85f5159facc886e11f640adabd90b37315d2d1fa547e3b1
- `model.json`: 54f12e719b964b58cfd09a3413533d2b470d349ff2dbd90ffe834f153d8941ca
- `presence_prompt.txt`: e17ff402c58f68faf8b5fadea2ff2852d69b7fa72414f04b73ac92b9fcd1fe64
- `presence_schema.json`: a592292e3866d951a0ac9d7ff05135d99f598c13e6e9c0c23e2fd890f9c22ea9
- `study_lists.json`: b3edd92d224a77e3d8774d27ae75e38b64255b72056821e45e3a3f19af8d5110
