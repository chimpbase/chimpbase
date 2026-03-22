#!/bin/bash
cd /home/marcelsud/projects/personal/chimp/chimpbase

PASS=0
FAIL=0
FAILED_TESTS=""

for test in examples/docs-validation/test-*.ts; do
  name=$(basename "$test" .ts | sed 's/test-//')
  printf "%-30s" "[$name]"

  output=$(timeout 20 bun run "$test" 2>&1)
  exit_code=$?

  if echo "$output" | grep -q ": OK" && [ $exit_code -eq 0 ]; then
    echo "PASS"
    PASS=$((PASS + 1))
  else
    echo "FAIL"
    FAIL=$((FAIL + 1))
    FAILED_TESTS="$FAILED_TESTS $name"
    echo "--- output ---"
    echo "$output" | tail -20
    echo "--- end ---"
  fi
done

echo ""
echo "================================"
echo "Results: $PASS passed, $FAIL failed"
if [ $FAIL -gt 0 ]; then
  echo "Failed:$FAILED_TESTS"
  exit 1
fi
