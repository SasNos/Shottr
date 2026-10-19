export default {
  extends: ['stylelint-config-standard'],
  rules: {
    // Notation follows Mber Flow's theme.css, the design source shared with Spark: six digit hex, rgba().
    'color-hex-length': null,
    'color-function-notation': null,
    'color-function-alias-notation': null,
    'alpha-value-notation': null,
    'custom-property-empty-line-before': null,
    // Reports `a:hover:not(:disabled), a:focus-visible` style lists, which are intended.
    'no-descending-specificity': null,
  },
};
