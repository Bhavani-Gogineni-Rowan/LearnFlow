import io
import os
import json
from fastapi import FastAPI, UploadFile, File, Form
import google.generativeai as genai
from PyPDF2 import PdfReader
from dotenv import load_dotenv

app = FastAPI()

# Load environment variables from .env file
load_dotenv()
genai.configure(api_key=os.getenv("GEMINI_API_KEY"))

@app.post("/generate-plan")
async def generate_plan(
    days: int = input('Enter number of days: '),
    hours: int = input('Enter number of hours: '),
    text_input: str = input('Enter syllabus text (or leave blank to upload a file): '),
    file: UploadFile = File(None)
):
    # Extract syllabus text
    syllabus_text = text_input or ""
    
    print(text_input)
    if file:
        content = await file.read()
        pdf_reader = PdfReader(io.BytesIO(content))
        for page in pdf_reader.pages:
            syllabus_text += page.extract_text()

    # The AI Prompt
    model = genai.GenerativeModel('gemini-3-flash-preview')

    prompt = f"""
    Create a detailed study plan based on this syllabus: {syllabus_text}
    Constraint: {days} days total, {hours} hours per day.

    Return the response as a JSON object with this exact structure:
    {{
      "plan": [
        {{
          "day": 1,
          "topics": ["Topic A", "Topic B"],
          "resources": ["URL 1", "URL 2"],
          "quiz": [
            {{"question": "Q1", "options": ["A", "B", "C"], "answer": "A","explanation": "Explanation of why A is correct based on the topic."}},
            {{"question": "Q2", "options": ["A", "B", "C"], "answer": "B","explanation": "Explanation of why B is correct based on the topic."}}
          ]
        }}
      ]
    }}
    """
    

    response = model.generate_content(
        prompt, 
        generation_config={"response_mime_type": "application/json"}
    )
    
    print("AI Response:", response.text)
    return json.loads(response.text)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
