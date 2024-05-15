#!/bin/bash

### I really hope this is just a temporary script. We cannot specify clone-upgradable-programs in
### Anchor.toml, so we need to clone the upgradeable programs manually.

bash $(dirname $0)/run_test_validator.sh 32

### Start up wait.
sleep 10

### Run the tests.
anchor run test-upgrade-fork

EXIT_CODE=$?

### Finally kill the validator.
kill $(cat .validator_pid)
rm .validator_pid

exit $EXIT_CODE
