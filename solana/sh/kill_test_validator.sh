#!/bin/bash

set -euo pipefail

kill $(cat .validator_pid)
rm .validator_pid