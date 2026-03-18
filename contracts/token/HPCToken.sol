// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {HPCConstants} from "../libraries/HPCConstants.sol";

/**
 * @title HPCToken
 * @notice BEP-20 token for HPVideo with fixed supply of 1 billion HPC.
 *         No mint, no burn. Users may send tokens to a black-hole address
 *         (e.g. 0x...dead) at their own discretion.
 */
contract HPCToken is ERC20, ERC20Permit, Ownable2Step {
    constructor(address initialOwner)
        ERC20("HPVideo", "HPC")
        ERC20Permit("HPVideo")
        Ownable(initialOwner)
    {
        _mint(initialOwner, HPCConstants.TOTAL_SUPPLY);
    }
}
