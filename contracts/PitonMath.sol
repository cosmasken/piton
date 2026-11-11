// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title PitonMath
/// @notice Black-Scholes and fixed-point helpers used by OptionPool, moved into a linked library so the pool
///         contract stays under the 24,576-byte limit. Code is unchanged from OptionPool (prices are identical).
library PitonMath {
    uint256 internal constant P = 1e18;
    uint256 internal constant R = 5e16; // 5% risk-free rate, 18 dec (same as OptionPool.R)

    /// @dev Fixed-point natural log (1e18 scaled). Range-reduces x to [1/sqrt2, sqrt2)
    ///      then uses ln(y) = 2*(z + z^3/3 + z^5/5 + z^7/7), z=(y-1)/(y+1), |z|<=0.172.
    ///      Truncation error < 3e-8.
    function _ln(uint256 x) internal pure returns (int256) {
        require(x > 0, "ln(0)");
        int256 k = 0;
        uint256 y = x;
        while (y >= 1414213562373095048) { y /= 2; k++; }
        while (y < 707106781186547524)   { y *= 2; k--; }
        int256 yi = int256(y);
        int256 z  = (yi - 1e18) * 1e18 / (yi + 1e18);
        int256 z2 = z * z / 1e18;
        int256 z4 = z2 * z2 / 1e18;
        int256 z6 = z4 * z2 / 1e18;
        int256 lny = 2 * z * (1e18 + z2 / 3 + z4 / 5 + z6 / 7) / 1e18;
        int256 ln2 = 693147180559945309; // ln(2) * 1e18
        return lny + k * ln2;
    }

    /// @dev sqrt of a 1e18-scaled value, returned 1e18-scaled (i.e. sqrt(x/1e18)*1e18).
    function _sqrt(uint256 x) internal pure returns (uint256) {
        if (x == 0) return 0;
        uint256 n = x * P;      // integer sqrt of x*1e18
        uint256 y = n;
        uint256 z = (n + 1) / 2;
        while (z < y) { y = z; z = (n / z + z) / 2; }
        return y;
    }

    /// @dev Standard normal CDF via A&S 26.2.17, input 1e18 scaled
    function _cdf(int256 x) internal pure returns (uint256) {
        bool neg = x < 0;
        uint256 ax = neg ? uint256(-x) : uint256(x);
        // clamp — beyond ±8 the result is effectively 0 or 1
        if (ax > 8e18) return neg ? 0 : P;

        uint256 k1 = P * 1e18 / (P + 2316419 * ax / 1e7);
        uint256 pdf = _expNeg(ax * ax / (2 * 1e18)) * P / 2506628274631000502; // /sqrt(2π)*1e18

        uint256 k2 = k1 * k1 / P;
        uint256 k3 = k2 * k1 / P;
        uint256 k4 = k3 * k1 / P;
        uint256 k5 = k4 * k1 / P;

        // A&S signs: +a1 -a2 +a3 -a4 +a5
        uint256 a1 = 3193815300  * k1 / 1e10;
        uint256 a2 = 3565637820  * k2 / 1e10;
        uint256 a3 = 17814779370 * k3 / 1e10;
        uint256 a4 = 18212559780 * k4 / 1e10;
        uint256 a5 = 13302744290 * k5 / 1e10;
        uint256 pos  = a1 + a3 + a5;
        uint256 negP = a2 + a4;
        uint256 t = pos > negP ? (pos - negP) : 0;

        uint256 result = P - pdf * t / P;
        return neg ? P - result : result;
    }

    /// @dev e^(-x) for x >= 0, 1e18 scaled, via exp(-x) = 1/exp(x)
    function _expNeg(uint256 x) internal pure returns (uint256) {
        // Use series: e^x = sum x^n/n! up to n=20 for x < 20
        if (x >= 20e18) return 0;
        uint256 result = P;
        uint256 term   = P;
        for (uint256 i = 1; i <= 20; i++) {
            term = term * x / (i * P);
            result += term;
        }
        return P * P / result;
    }

    /// @dev sqrt of a 1e18-scaled value, returned 1e18-scaled. Public so the pool can call it (linked library).
    function sqrt(uint256 x) public pure returns (uint256) { return _sqrt(x); }

    /// @dev Black-Scholes premium per 1 unit, all inputs 1e18 scaled
    function bs(
        bool    isCall,
        uint256 spot,
        uint256 strike,
        uint256 timeToExpirySeconds,
        uint256 vol
    ) public pure returns (uint256) {
        if (timeToExpirySeconds == 0 || spot == 0 || strike == 0) return 0;
        // T in years, 1e18 scaled
        uint256 T    = timeToExpirySeconds * P / 365 days;
        uint256 sqrtT = _sqrt(T);
        uint256 ivSqrtT = vol * sqrtT / P;

        // d1 = (ln(S/K) + (r + iv²/2)*T) / (iv*√T)
        int256 lnSK  = _ln(spot * P / strike);
        uint256 iv2  = vol * vol / P;
        int256 drift = int256((R + iv2 / 2) * T / P);
        int256 d1    = (lnSK + drift) * int256(P) / int256(ivSqrtT);
        int256 d2    = d1 - int256(ivSqrtT);

        if (isCall) {
            uint256 nd1 = _cdf(d1);
            uint256 nd2 = _cdf(d2);
            uint256 discStrike = strike * _expNeg(R * T / P) / P;
            uint256 a = spot * nd1 / P;
            uint256 b = discStrike * nd2 / P;
            return a > b ? a - b : 0;
        } else {
            uint256 nd1neg = _cdf(-d1);
            uint256 nd2neg = _cdf(-d2);
            uint256 discStrike = strike * _expNeg(R * T / P) / P;
            uint256 a = discStrike * nd2neg / P;
            uint256 b = spot * nd1neg / P;
            return a > b ? a - b : 0;
        }
    }
}
