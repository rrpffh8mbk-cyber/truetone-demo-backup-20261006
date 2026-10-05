# Lip ROI regression checks

From the repository root, run `python3 -m http.server 8000`, then open
`/tests/lips-regression.html` on that server in a modern browser. The page must
report `PASS`. It uses a deterministic FaceMesh test double and synthetic images,
so these regression checks require no model download or credentials.

The checks cover blue, red and purple lip colors against a red background,
exclusion of the mouth interior, concurrent analysis and try-on requests,
missing faces, model errors, and recovery after errors. They exercise the actual
canvas mask and pixel-analysis code. FaceMesh detection accuracy should also be
checked on real portraits using the normal upload flow.
