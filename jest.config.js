/** @type {import("ts-jest").JestConfigWithTsJest} */
const config = {
  preset: "ts-jest",
  testEnvironment: "node",
  coverageReporters: ["json", "html", "text"],
};
export default config
