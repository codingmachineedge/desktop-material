{
  # Node >= 24 headers ship enable_thin_lto=true/lto_jobs=2 in config.gypi,
  # which makes common.gypi's Release config inject clang/lld-only flags
  # (-flto=thin, /opt:lldltojobs=N) that MSVC cl/link reject (LNK1117).
  # This is a plain C executable, so LTO is unwanted. Includes overwrite
  # plain top-level variables, and target-level variables are out of scope
  # for target_defaults conditions, so set these via the
  # conditions-inside-variables pattern, which gyp applies after includes
  # are merged.
  "variables": {
    "conditions": [
      ["OS=='win'", {
        "enable_lto": "false",
        "enable_thin_lto": "false",
        "lto_jobs": "",
      }]
    ]
  },
  "targets": [
    {
      "target_name": "printenvz",
      "type": "executable",
      "sources": [
        "src/printenvz.c"
      ],
      "include_dirs": [],
      'cflags': [
          '-Wall',
          '-Werror',
          '-fPIC',
          '-pie',
          '-D_FORTIFY_SOURCE=1',
          '-fstack-protector-strong',
          '-Werror=format-security',
        ],
      'ldflags': [
        '-z relro',
        '-z now'
      ],
      "conditions": [
        ["OS=='mac'", {
          "xcode_settings": {
            "OTHER_CFLAGS": [
              '-Wall',
              '-Werror',
              '-Werror=format-security',
              '-fPIC',
              '-D_FORTIFY_SOURCE=1',
              '-fstack-protector-strong'
            ],
            "MACOSX_DEPLOYMENT_TARGET": "10.7"
          }
        }]
      ]
    }
  ]
}
