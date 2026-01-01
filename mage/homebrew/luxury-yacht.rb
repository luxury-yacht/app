cask "luxury-yacht" do
  name "Luxury Yacht"
  desc "Luxury Yacht is a desktop app for managing Kubernetes clusters"

  app "Luxury Yacht.app"
  version "${VERSION}"

  arch   arm: "arm64"
         intel: "amd64"
  sha256 arm: "${ARM64_SHA256}"
         intel: "${AMD64_SHA256}"

  url "https://github.com/luxury-yacht/app/releases/download/#{version}/luxury-yacht-#{version}-macos-#{arch}.dmg",
    verified: "github.com/luxury-yacht/app/"
  homepage "https://github.com/luxury-yacht/app"

  auto_updates true

  zap trash: [
    "~/Library/Application Support/luxury-yacht",
  ]
end
