Pod::Spec.new do |s|
  s.name           = 'ChitChatCore'
  s.version        = '0.1.0'
  s.summary        = 'ChitChat protected MLS and media cryptography core'
  s.description    = 'Native iOS wrapper for the shared Rust MLS core.'
  s.license        = { :type => 'UNLICENSED' }
  s.author         = 'ChitChat'
  s.homepage       = 'https://github.com/skmohammadali786/ChitChat'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { :git => 'https://github.com/skmohammadali786/ChitChat.git', :tag => s.version.to_s }
  s.source_files   = '**/*.{h,m,mm,swift}'
  s.vendored_frameworks = 'Frameworks/ChitChatCore.xcframework'
  s.prepare_command = 'bash ../../../scripts/build-rust-ios.sh'
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'Security'
  s.libraries = 'sqlite3', 'c++'
end
