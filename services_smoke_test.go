package main

import (
	"testing"
)

func TestListServicesSmoke(t *testing.T) {
	s := &Service{}
	services, err := s.ListServices()
	if err != nil {
		t.Fatalf("ListServices failed: %v", err)
	}
	t.Logf("got %d services", len(services))
	for _, sv := range services {
		t.Logf("  %-12s status=%s user=%s file=%s pid=%s exit=%s",
			sv.Name, sv.Status, sv.User, sv.File, sv.Pid, sv.ExitCode)
		if sv.Name == "" {
			t.Errorf("service with empty name found")
		}
	}
}

func TestParseServicesTable(t *testing.T) {
	s := &Service{}
	input := `Name    Status  User   File
mysql   started bob    ~/Library/LaunchAgents/homebrew.mxcl.mysql.plist
redis   stopped
nginx   none
apache  started /Library/LaunchDaemons/org.apache.httpd.plist
`
	services, err := s.parseServicesTable(input)
	if err != nil {
		t.Fatalf("parseServicesTable failed: %v", err)
	}
	if len(services) != 4 {
		t.Fatalf("expected 4 services, got %d: %+v", len(services), services)
	}
	// name + status
	if services[0].Name != "mysql" || services[0].Status != "started" {
		t.Errorf("mysql row wrong: %+v", services[0])
	}
	if services[0].User != "bob" || services[0].File != "~/Library/LaunchAgents/homebrew.mxcl.mysql.plist" {
		t.Errorf("mysql user/file wrong: %+v", services[0])
	}
	// stopped without user/file
	if services[1].Name != "redis" || services[1].Status != "stopped" || services[1].User != "" || services[1].File != "" {
		t.Errorf("redis row wrong: %+v", services[1])
	}
	// none
	if services[2].Name != "nginx" || services[2].Status != "none" {
		t.Errorf("nginx row wrong: %+v", services[2])
	}
	// file without user (path starts with '/')
	if services[3].User != "" || services[3].File != "/Library/LaunchDaemons/org.apache.httpd.plist" {
		t.Errorf("apache row wrong: %+v", services[3])
	}
}

func TestFormatServiceField(t *testing.T) {
	cases := []struct {
		in   interface{}
		want string
	}{
		{nil, ""},
		{42.0, "42"},
		{42.5, "42.5"},
		{"42", "42"},
	}
	for _, c := range cases {
		if got := formatServiceField(c.in); got != c.want {
			t.Errorf("formatServiceField(%v) = %q, want %q", c.in, got, c.want)
		}
	}
}
