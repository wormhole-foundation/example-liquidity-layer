# Matching Engine Program

A program to facilitate the transfer of USDC between networks that allow Wormhole and CCTP bridging.
With the help of solvers, allowing USDC to be transferred faster than finality.

## Testing plan

The testing engine should be designed in a functional way that allows for easy testing of the program instructions.

The instructions passed to the testing engine should be able to be composed in a way where each instruction returns the updated state (not a mutating state).

This state is predictable and has the benefit of being able to be tested in isolation and mocked (to an extent) for testing.


