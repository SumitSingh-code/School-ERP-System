import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "no-restricted-properties": ["error",
        { property: "$queryRaw", message: "Raw SQL is blocked. Use Prisma model APIs or an approved schoolId-scoped helper." },
        { property: "$executeRaw", message: "Raw SQL is blocked. Use Prisma model APIs or an approved schoolId-scoped helper." },
        { property: "$queryRawUnsafe", message: "Raw SQL is blocked. Use Prisma model APIs or an approved schoolId-scoped helper." },
        { property: "$executeRawUnsafe", message: "Raw SQL is blocked. Use Prisma model APIs or an approved schoolId-scoped helper." },
      ],
      "no-restricted-syntax": ["error",
        { selector: "MemberExpression[property.name='$queryRaw']", message: "Raw SQL is blocked; use a school-scoped Prisma operation." },
        { selector: "MemberExpression[property.name='$executeRaw']", message: "Raw SQL is blocked; use a school-scoped Prisma operation." },
        { selector: "MemberExpression[property.name='$queryRawUnsafe']", message: "Raw SQL is blocked; use a school-scoped Prisma operation." },
        { selector: "MemberExpression[property.name='$executeRawUnsafe']", message: "Raw SQL is blocked; use a school-scoped Prisma operation." },
        { selector: "MemberExpression[property.value='$queryRaw']", message: "Raw SQL is blocked; use a school-scoped Prisma operation." },
        { selector: "MemberExpression[property.value='$executeRaw']", message: "Raw SQL is blocked; use a school-scoped Prisma operation." },
        { selector: "MemberExpression[property.value='$queryRawUnsafe']", message: "Raw SQL is blocked; use a school-scoped Prisma operation." },
        { selector: "MemberExpression[property.value='$executeRawUnsafe']", message: "Raw SQL is blocked; use a school-scoped Prisma operation." },
        { selector: "Property[key.name='$queryRaw']", message: "Do not destructure raw Prisma methods." },
        { selector: "Property[key.name='$executeRaw']", message: "Do not destructure raw Prisma methods." },
        { selector: "Property[key.name='$queryRawUnsafe']", message: "Do not destructure raw Prisma methods." },
        { selector: "Property[key.name='$executeRawUnsafe']", message: "Do not destructure raw Prisma methods." },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
