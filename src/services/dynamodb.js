import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import dotenv from 'dotenv'

// Cargar las variables de entorno
dotenv.config()

export class DynamoDBService {
  constructor() {
    this.client = new DynamoDBClient({ region: process.env.AWS_REGION })
    this.docClient = DynamoDBDocumentClient.from(this.client)
    this.tableName = 'Talky_WhatsApp_Bots_Prompts_Data_Base'
    this.userId = process.env.USER_ID
  }

  // Obtener los datos actuales del usuario
  async getCurrentData() {
    const command = new GetCommand({
      TableName: this.tableName,
      Key: {
        userId: this.userId
      }
    })
    
    const response = await this.docClient.send(command)
    return response.Item || {
      userId: this.userId,
      history: [],
      modifications: [],
      prompt: ''
    }
  }

  // Guardar una nueva modificación
  async saveModification(modification) {
    const currentData = await this.getCurrentData()

    // Agregar a las modificaciones
    const modifications = [...(currentData.modifications || [])]
    modifications.unshift(modification)

    // Agregar al historial
    // Mantenemos todo el historial, sin borrarlo
    const history = [...(currentData.history || []), modification]

    // Actualizamos la tabla
    const command = new UpdateCommand({
      TableName: this.tableName,
      Key: {
        userId: this.userId
      },
      UpdateExpression: 'SET modifications = :m, history = list_append(if_not_exists(history, :empty_list), :h)',
      ExpressionAttributeValues: {
        ':m': modifications,
        ':h': [modification],
        ':empty_list': []
      }
    })

    return await this.docClient.send(command)
  }

  // Limpiar la lista de modificaciones
  // (conservamos el historial para tener registro de todo)
  async clearModifications() {
    const command = new UpdateCommand({
      TableName: this.tableName,
      Key: {
        userId: this.userId
      },
      UpdateExpression: 'SET modifications = :emptyList',
      ExpressionAttributeValues: {
        ':emptyList': []
      }
    })

    return await this.docClient.send(command)
  }

  // Actualizar el prompt
  async updatePrompt(newPrompt) {
    const command = new UpdateCommand({
      TableName: this.tableName,
      Key: {
        userId: this.userId
      },
      UpdateExpression: 'SET prompt = :p',
      ExpressionAttributeValues: {
        ':p': newPrompt
      }
    })

    return await this.docClient.send(command)
  }

  // Obtener las modificaciones actuales
  async getModifications() {
    const data = await this.getCurrentData()
    return data.modifications || []
  }

  // Obtener el prompt actual
  async getPrompt() {
    const data = await this.getCurrentData()
    return data.prompt || ''
  }

  // Obtener el historial completo
  async getHistory() {
    const data = await this.getCurrentData()
    return data.history || []
  }
}
