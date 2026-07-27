/* labConfig.js — calibration constants for the Portfolio Lab page.
   These are the ONLY tunable assumptions in the Lab's math (LESSONS 8.2:
   the calibration file IS the spec — the page and the Methodology copy both
   read from here; never hardcode these in UI).

   ERP_ANNUAL — implied equity risk premium for the US market.
   Source: Aswath Damodaran, mature-market implied ERP, January 2026 annual
   update (pages.stern.nyu.edu/~adamodar, ctryprem datafile: 4.23% as of
   2026-01-05). Senior Quant reviews quarterly; update the value AND the
   source line together. */

export const ERP_ANNUAL = 0.0423;
export const ERP_SOURCE = 'Damodaran implied equity risk premium, January 2026 update';

/* Minimum aligned trading days of price history a holding needs before CAPM
   beta / the optimizer will use it (~1 trading year). Below this the page
   shows "insufficient history" instead of a number (LESSONS 4.4). */
export const MIN_HISTORY_DAYS = 252;
