# SenCity export for the app: survey v9

- Source commit: 86491d3e19fc5dfcadea83a15069b59cb19e4b0f
- Export date: 2026-11-18
- Codebook: config/codebook_2026-11-12.yaml (version 2026-11-12, sha 68b993d1b4f4)
- Contains no participant data, no images, no API keys.
- Profile: every field is filled from `part_a.json` alone (A11, A12, A13, A16) plus the answer language; no field comes from A1-A5 or A15.
- Task: `task_template.txt` is the study's v9 single-photo task text (B1 + B2, eight-senses line included); the element list is filled per photo (`task_rules.json`).
- Presence check (D150, run once on the 20 study photos, untuned): agreement with the confirmed lists 91.7% (365/398 answers); 96% of the confirmed elements found; 82% of the model's elements are in the confirmed lists. App lists run about 18% long, mostly Direct sun, Shade and Nice buildings; Crowds was missed on 3 of 20 photos. App presence prompt (D157): the strict prompt plus the crowds definition (about 5 or more people close together, or people across most of the walkable space); run once on the same 20 photos: agreement 91.7% (365/398), 96% found, 83% confirmed; Crowds still missed on 3 of 20 (place04, place10, place19). App presence prompt (D163): the strict prompt with Crowds asked as a count (people_count) and decided in code at 8 or more people (presence_schema.json `crowds`), a threshold tuned on the same 20 photos; run once: agreement 92.5% (368/398), 99% found, 83% confirmed; Crowds 20/20 against photos_meta people = many. Future work: check the threshold on fresh photos; users review the automatic lists before they are used.
- Formula (H2; D159, D161): `formula_xhat.txt` and `formula_f.txt` are the study's V2 + x-hat and V2 + f paragraphs, filled and placed as `formula_rules.json` says. x-hat, the coefficients and the others' average are learned from participants' answers and are not in this export.
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
- `presence_prompt.txt`: 2836fccc880d4f13f7094f8bc4c9b0653ad8602ee9868863e5dd4be8dac91f16
- `presence_schema.json`: fbae691f9a61caee2a43ca0a32fd911a0d63456d547e4e60672821c84eb2de6a
- `study_lists.json`: 27c89a4f4877eed4d6ce56611957edcd66cff55501f85efc3ecfbe84ea03a5d7
- `formula_xhat.txt`: 0a1df0f132add494638a5cfd5188afa66f0fb20933e593e9933937dab1f9a512
- `formula_f.txt`: db6d5960c314275f066c1274ac64e03a857461bf5647c0cddf2d29cd9c5cbb0c
- `formula_rules.json`: 7023e49b1a71c1a63c23f842a56b9debf5188426d6d31089717a971a3774e16d
