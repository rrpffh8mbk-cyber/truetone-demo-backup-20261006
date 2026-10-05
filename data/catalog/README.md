# TrueTone data catalog

This directory stores lightweight indexes and derived metadata only.

- Raw scraped images, videos and source tables remain in private Alibaba Cloud OSS.
- GitHub should not become the raw media store; this keeps the public demo repository small and avoids exposing the full scraped corpus.
- `source_registry.json` records the OSS prefixes and dataset counts.
- `tag_schema.json` is the single vocabulary used by both user-profile inputs and evidence-library labels.
- `top_reference_candidates_v1.json` is a technical preselection of candidate reference images. It is not the final semantic/personalized ranking.

Final Top Reference ranking should combine:
1. technical image quality;
2. evidence completeness;
3. agreement with the full multi-source dataset;
4. semantic labels (lip / skin / makeup / lighting / application);
5. platform diversity;
6. match to the current user's profile.

Unknown semantic attributes must stay `不确定` rather than being guessed.
