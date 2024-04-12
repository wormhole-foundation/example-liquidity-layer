// SPDX-License-Identifier: Apache 2
pragma solidity >=0.8.8 <0.9.0;

import "./external/Initializable.sol";
import "openzeppelin-contracts/contracts/proxy/ERC1967/ERC1967Upgrade.sol";

/// @dev This contract should be used as a base contract for implementation contracts
///      that are used with ERC1967Proxy.
///      It ensures that the contract cannot be initialized directly, only through
///      the proxy (by disabling initializers in the constructor).
///      It also exposes a migrate function that is called during upgrades.
abstract contract Implementation is Initializable, ERC1967Upgrade {
    address immutable _this;

    error OnlyDelegateCall();
    error NotMigrating();

    constructor() {
        _disableInitializers();
        _this = address(this);
    }

    modifier onlyDelegateCall() {
        _checkDelegateCall();
        _;
    }

    struct _Migrating {
        bool isMigrating;
    }

    struct _Bool {
        bool value;
    }

    // keccak256(ll.migrating) - 1
    bytes32 private constant MIGRATING_SLOT =
        0xbbd20ff4b49567c06346afe56e8ef93c6ad369381bfcbbc717674577182819c6;

    // keccak256(ll.migratesImmutables) - 1
    bytes32 private constant MIGRATES_IMMUTABLES_SLOT =
        0xe0760c100f4f7987b71e72343e04776f5f180cf968c0fe3a1e429da0bb7630d0;

    function _getMigratingStorage() private pure returns (_Migrating storage $) {
        uint256 slot = uint256(MIGRATING_SLOT);
        assembly ("memory-safe") {
            $.slot := slot
        }
    }

    function _getMigratesImmutablesStorage() internal pure returns (_Bool storage $) {
        uint256 slot = uint256(MIGRATES_IMMUTABLES_SLOT);
        assembly ("memory-safe") {
            $.slot := slot
        }
    }

    function _checkDelegateCall() internal view {
        if (address(this) == _this) {
            revert OnlyDelegateCall();
        }
    }

    function initialize(bytes memory initData) external payable onlyDelegateCall initializer {
        _initialize(initData);
    }

    function migrate() external onlyDelegateCall reinitializer(_getInitializedVersion() + 1) {
        // NOTE: we add the reinitializer() modifier so that onlyInitializing
        // functions can be called inside
        if (!_getMigratingStorage().isMigrating) {
            revert NotMigrating();
        }
        _migrate();
    }

    function _migrate() internal virtual;

    function _initialize(bytes memory initData) internal virtual;

    function _checkImmutables() internal view virtual;

    function _upgrade(address newImplementation) internal {
        _checkDelegateCall();
        _upgradeTo(newImplementation);

        _Migrating storage _migrating = _getMigratingStorage();
        assert(!_migrating.isMigrating);
        _migrating.isMigrating = true;

        this.migrate();
        if (!this.getMigratesImmutables()) {
            _checkImmutables();
        }
        _setMigratesImmutables(false);

        _migrating.isMigrating = false;
    }

    function getMigratesImmutables() public view returns (bool) {
        return _getMigratesImmutablesStorage().value;
    }

    function _setMigratesImmutables(bool value) internal {
        _getMigratesImmutablesStorage().value = value;
    }
}
