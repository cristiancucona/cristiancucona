module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    testMatch: ['**/test/integration/**/*.test.ts'],
    setupFilesAfterEnv: ['./test/setup.ts'],
};
