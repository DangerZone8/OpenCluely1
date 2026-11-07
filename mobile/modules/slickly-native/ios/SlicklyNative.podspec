Pod::Spec.new do |s|
  s.name           = 'SlicklyNative'
  s.version        = '1.0.0'
  s.summary        = 'Slickly native platform integrations'
  s.description    = 'Android overlay bridge and iOS ReplayKit picker/context bridge.'
  s.license        = { :type => 'MIT' }
  s.author         = 'Slickly'
  s.homepage       = 'https://slicklyai.vercel.app'
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => 'https://example.invalid/SlicklyNative.git', :tag => s.version.to_s }
  s.source_files   = '**/*.{h,m,mm,swift}'
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'ReplayKit'
  s.swift_version = '5.9'
end
