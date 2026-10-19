package main

import (
	"errors"
	"fmt"
	"testing"

	"github.com/xpzouying/xiaohongshu-mcp/xiaohongshu"
)

func TestPublicationFailureEvidence(t *testing.T) {
	for _, err := range []error{errors.New("context deadline exceeded"), errors.New("发布后响应异常"), errors.New("导航到发布页面失败: context deadline exceeded")} {
		result := publishFailureResult(err)
		if !result.IsError || result.StructuredContent != nil {
			t.Fatal("untyped failure must not allow retry")
		}
	}
	err := fmt.Errorf("wrapped: %w", &xiaohongshu.PublishPreparationError{Cause: errors.New("preparation failed")})
	result := publishFailureResult(err)
	evidence := result.StructuredContent.(map[string]interface{})["publishOutcome"].(map[string]interface{})
	if evidence["stage"] != "prepare" || evidence["publishClicked"] != false || evidence["safeToRetry"] != true {
		t.Fatal(evidence)
	}
	converted := convertToMCPResult(result)
	if converted.StructuredContent == nil || !converted.IsError {
		t.Fatal("SDK must preserve retry evidence")
	}
}
