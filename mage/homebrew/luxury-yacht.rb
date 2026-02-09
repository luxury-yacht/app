cask "luxury-yacht" do
  arch arm: "arm64", intel: "amd64"

  version "${VERSION}"
  sha256 arm:   "${ARM64_SHA256}",
         intel: "${AMD64_SHA256}"

  url "https://github.com/luxury-yacht/app/releases/download/v#{version}/luxury-yacht-v#{version}-macos-#{arch}.dmg",
      verified: "github.com/luxury-yacht/app/"
  name "Luxury Yacht"
  desc "Desktop app for managing Kubernetes clusters"
  homepage "https://luxury-yacht.app/"

  app "Luxury Yacht.app"

  zap trash: "~/Library/Application Support/luxury-yacht"

  caveats <<~EOS
  ⚠️ Luxury Yacht is now in the official Homebrew Cask repo.

  If you previously installed from the luxury-yacht tap, migrate with:

    brew uninstall luxury-yacht
    brew untap luxury-yacht/tap
    brew install luxury-yacht
  EOS
end
