from app.scorm_parser import extract_blank_answers

slide = {
  "tp": "FillInTheBlank",
  "C": {
    "rt": {
      "r": [
        {"data": {"v": ["hello"]}, "id": "qmFillInTheBlank0", "type": "qmFillInTheBlank"}
      ]
    }
  }
}
print(extract_blank_answers(slide))
