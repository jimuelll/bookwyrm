# What a Test Should Be

Guidelines for writing tests. Keep them small, readable, and focused on behavior.

## Core Principles

- **Test behavior, not implementation.** If you can refactor the code without changing behavior, no test should break.
- **One reason to fail.** Each test checks one behavior.
- **Readable at a glance.** A test should be understandable without jumping to other files.
- **Independent.** No shared state, no dependence on run order.
- **Fast.** Unit tests run in milliseconds: no network, no disk, no sleeping.

## Structure

Use Arrange, Act, Assert (or Given / When / Then):

```python
def test_apply_discount_caps_at_50_percent():
    order = Order(total=100)           # Arrange
    order.apply_discount(percent=80)   # Act
    assert order.total == 50           # Assert
```

- Aim for 5 to 15 lines per test.
- Name tests after the behavior: `test_withdraw_fails_when_balance_insufficient`, not `test_withdraw_2`.
- Mirror the source layout: `billing/invoice.py` -> `tests/billing/test_invoice.py`.

## What to Test

- Public behavior: inputs in, outputs or side effects out.
- The happy path.
- Edge cases that matter: empty input, boundaries, invalid input.
- Business rules and logic with branches.
- A regression test for every bug fix, which must fail without the fix.

## What Not to Test

- Trivial getters, setters, and pass-through code.
- The language or framework itself ("a list returns a list").
- Private methods or internal state.
- Inputs the code can never receive.
- Call counts and call order of internal functions.

## Mocking

- Mock only at system boundaries: external APIs, payments, email, clocks, randomness.
- Prefer real objects or simple fakes (e.g. an in-memory repository).
- Do not mock your own internal classes.
- If a test is mostly mock setup, it is testing the wiring, not the behavior.

## Setup and Data

- Use plain inline data for simple cases.
- Add fixtures or factories only when setup repeats across many tests.
- Use hardcoded expected values. Never recompute the expected value with the same logic as the code.
- Avoid custom helper layers, base classes, and abstractions inside test files.

## The Test Pyramid

| Level | Amount | Scope |
|---|---|---|
| Unit | Many | One function or class, no I/O |
| Integration | Some | Real database or service boundary |
| End-to-end | Few | Critical user flows only (login, checkout) |

## Overengineering Red Flags

- More test code than source code for simple logic.
- Dozens of near-duplicate tests with slightly different inputs.
- Heavy mocking of every dependency.
- Long docstrings or comments narrating trivial tests.
- Chasing 100% coverage with weak or missing assertions.
- Tests that mirror the implementation (and would encode its bugs).

## Quick Checks

- Can I change the implementation without changing the test, as long as behavior stays the same?
- Would this test fail if the logic were wrong?
- If I delete this test, do I lose confidence in the code? If not, delete it.
- Can someone understand what broke from the test name alone?

## Process

- Run tests in CI on every pull request. A failing test blocks the merge.
- Treat coverage targets (e.g. 70 to 80%) as a guardrail, not a goal.
- Review tests like production code, and push back on brittle or redundant ones.
