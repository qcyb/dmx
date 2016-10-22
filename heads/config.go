package heads

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/BurntSushi/toml"
	log "github.com/Sirupsen/logrus"
	"github.com/SpComb/qmsk-dmx"
)

func loadToml(obj interface{}, path string) error {
	if meta, err := toml.DecodeFile(path, obj); err != nil {
		return err
	} else if len(meta.Undecoded()) > 0 {
		return fmt.Errorf("Invalid keys in toml: %#v", meta.Undecoded())
	} else {
		return nil
	}
}

func load(obj interface{}, path string) (string, error) {
	base := filepath.Base(path)
	ext := filepath.Ext(path)

	name := base[:len(base)-len(ext)]

	switch ext {
	case ".toml":
		if err := loadToml(obj, path); err != nil {
			return name, err
		} else {
			return name, nil
		}
	default:
		return name, fmt.Errorf("Unknown %T file ext=%v: %v", obj, ext, path)
	}
}

type ChannelClass string

const (
	ChannelClassControl   ChannelClass = "control"
	ChannelClassIntensity              = "intensity"
	ChannelClassColor                  = "color"
)

type ChannelConfig struct {
	Class ChannelClass
	Name  string
}

type HeadType struct {
	Vendor   string
	Model    string
	Mode     string
	URL      string
	Channels []ChannelConfig
}

type HeadConfig struct {
	Type     string
	Universe Universe
	Address  dmx.Address

	headType *HeadType
}

type Config struct {
	headTypes map[string]*HeadType

	Heads []HeadConfig
}

func (config *Config) loadTypes(rootPath string) error {
	return filepath.Walk(rootPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		var headType HeadType

		log.Debugf("heads:Config.loadTypes %v: %v mode=%v", rootPath, path, info.Mode())

		if !info.Mode().IsRegular() {
			return nil
		}

		relPath := path[len(rootPath):]
		if relPath[0] == '/' {
			relPath = relPath[1:]
		}
		dir, name := filepath.Split(relPath)

		if basename, err := load(&headType, path); err != nil {
			return err
		} else {
			name = filepath.Join(dir, basename)
		}

		log.Infof("heads:Config.loadTypes %v: HeadType %v", path, name)

		config.headTypes[name] = &headType

		return nil
	})
}

func (options Options) Config(path string) (*Config, error) {
	var config = Config{
		headTypes: make(map[string]*HeadType),
	}

	if err := config.loadTypes(options.LibraryPath); err != nil {
		return nil, fmt.Errorf("loadTypes %v: %v", options.LibraryPath, err)
	}

	if _, err := load(&config, path); err != nil {
		return nil, err
	}

	return &config, nil
}
