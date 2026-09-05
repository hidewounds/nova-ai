module.exports = {
    apps: [
        {
            name: "nova-api",
            script: "server/index.js",
            cwd: ".",
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: "1G",
            env: {
                NODE_ENV: "production",
                PORT: 3000,
            },
        },
        {
            name: "nova-echo-sidecar",
            script: "echo/server.py",
            interpreter: "python",
            interpreter_args: "-u",
            args: "--model base --port 8765 --host 127.0.0.1",
            cwd: ".",
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: "4G",
            env: {
                ECHO_MODEL: "base",
                ECHO_PORT: "8765",
                ECHO_HOST: "127.0.0.1",
                PYTHONPATH: "./echo",
            },
        },
    ],
};