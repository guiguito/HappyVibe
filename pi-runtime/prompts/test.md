---
description: Write tests for a file, following this project's existing conventions
argument-hint: "<file or symbol to test>"
---
Write tests for `${ARGUMENTS:-the file I am currently working in}`.

**1. Learn the conventions before writing anything.** Find the existing test suite, read two or three tests near the code under test, and copy their runner, file naming, layout and assertion style. Check how the project runs a single test file and use that command. Do not introduce a new test framework, a new helper layer, or fixtures the project does not already use.

**2. Read the code under test properly.** List its real behaviours: the happy path, each branch, each error path, and every boundary (empty, missing, zero, one, many, malformed). Note what is already covered elsewhere so you do not write it twice.

**3. Write the tests that would actually catch a regression**, in this priority:

- the core behaviour, asserted on the observable output rather than internals;
- each error path, asserting the error the caller can act on;
- the boundaries and the one weird case the code clearly guards against.

Prefer real inputs to mocks. Mock only what is genuinely out of process — network, clock, filesystem when the project already does so. A test that only proves a mock was called proves nothing.

**4. Prove they work.** Run the suite. Then break the implementation on purpose (invert a condition, drop a guard), confirm the relevant test fails, and restore it. Report the command you ran and its real output — a test you have not seen fail is not yet a test.

Keep it proportional: a handful of tests that fail for the right reasons beats exhaustive coverage of trivia. Do not change the implementation to make testing easier without telling me why.
