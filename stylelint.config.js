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
    // Style guide: colors only as variables, spacing, type and radii only from the scales in theme.css.
    'color-no-hex': true,
    'color-named': 'never',
    'declaration-property-unit-disallowed-list': {
      '/^(font-size|line-height|border-radius|padding|margin|gap|row-gap|column-gap)/': ['px'],
    },
  },
  overrides: [
    {
      // The only place where raw values are defined.
      files: ['src/theme.css'],
      rules: { 'color-no-hex': null, 'declaration-property-unit-disallowed-list': null },
    },
  ],
};
